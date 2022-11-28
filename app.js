/*jslint node: true */
'use strict';

if (process.env.DEBUG === '1')
{
    require('inspector').open(9222, '0.0.0.0', true);
}

const Homey = require('homey');
const { HomeyAPIApp } = require('./homey-api');
const https = require("https");

const UPDATE_INTERVAL = (1000 * 60 * 60 * 23);

class MyApp extends Homey.App
{

    onInit()
    {
        this.log('MyApp is running...');
        this.checking = false;

        this.homey.settings.set('updateList', []);

        this.updateHr = this.homey.settings.get('updateHr');
        this.updateMin = this.homey.settings.get('updateMin');

        if (!this.updateHr)
        {
            this.updateHr = 8;
            this.updateMin = 0;
            this.homey.settings.set('updateHr', this.updateHr);
            this.homey.settings.set('updateMin', this.updateMin);
        }

        this.appUpdateTrigger = this.homey.flow.getTriggerCard('update_available');
    }

    async fireUpdateTrigger(Name, Store, OldVersion, NewVersion)
    {
        const tokens = {
            'update_app_name': Name,
            "update_app_store": Store,
            'update_app_old_ver': OldVersion,
            'update_app_new_ver': NewVersion
        };
        this.appUpdateTrigger.trigger(tokens)
            .then(this.log("update_available Trigger Complete"))
            .catch(this.error);
    }

    // Returns true if this app version has already been checked
    checkNotifiedList(AppId, Source, Version, notifiedList)
    {
        const appIndex = notifiedList.findIndex(element => (element.Id == AppId) && (element.Source == Source));
        if (appIndex >= 0)
        {
            // An entry for this app has been found so check if it is the same version as already reported
            if (notifiedList[appIndex].Version == Version)
            {
                // Version matched previous check
                //console.log("App: ", AppId, " Version: ", Version, " From: ", Source, " Already notified.");
                return true;
            }

            // Different version to previous check so update the array values
            notifiedList[appIndex].Version = Version;
            return false;
        }

        // App not in the list so it has not been checked yet
        let newAppInfo = {
            'Id': AppId,
            'Source': Source,
            'Version': Version,
        };

        notifiedList.push(newAppInfo);

        return false;
    }

    // Check each installed app against the community store to determine if any updates are available
    async checkForUpdates()
    {
        // Get the app settings
        const notify = this.homey.settings.get('autoNotify');
        const update = this.homey.settings.get('autoUpdate');

        if (await this.checkNow(notify, update))
        {
            this.updateTimeout();
        }
    }

    updateTimeout()
    {
        if (this.timeoutID)
        {
            clearTimeout(this.timeoutID);
        }

        // Calculate the time until the required check time
        this.updateHr = this.homey.settings.get('updateHr');
        this.updateMin = this.homey.settings.get('updateMin');
        const nowTime = new Date(Date.now());
        let newTime = new Date(Date.now());
        if (nowTime.getHours() > this.updateHr)
        {
            // next time is tomorrow
            newTime.setDate(newTime.getDate() + 1);
        }
        else if ((nowTime.getHours() == this.updateHr) && (nowTime.getMinutes() >= this.updateMin))
        {
            // next time is tomorrow
            newTime.setDate(newTime.getDate() + 1);
        }

        newTime.setHours(this.updateHr);
        newTime.setMinutes(this.updateMin);
        newTime = newTime - nowTime;

        //console.log("Next check in (ms): ", newTime.valueOf());

        // Setup timer for next check
        this.timeoutID = this.homey.setTimeout(this.checkForUpdates.bind(this), newTime.valueOf());

        // convert to minutes
        newTime /= (1000 * 60);
        let hours = parseInt(newTime / 60);
        let mins = newTime - (hours * 60);
        var formattedMins = ("0" + mins).slice(-2);

        return `Next update in ${hours}:${formattedMins} hrs:mins`;
    }

    async checkNow(notify, update)
    {
        if (!this.checking)
        {
            this.checking = true;
            let notifiedList = await this.homey.settings.get('notifiedList');
            if (!notifiedList)
            {
                notifiedList = [];
            }

            let status = "";
            try
            {
                this.log("Check for updates");

                this.homey.api.realtime('com.community.store.showUpdates', { 'fetching': 'HCS app list' });
                // Get the array of apps and version numbers from the Community store
                const communityData = await this.fetchCommunityVersions();
                const updateList = [];

                this.homey.api.realtime('com.community.store.showUpdates', { 'fetching': 'Homey app list' });
                // Get the list of installed apps
                const api = new HomeyAPIApp(
                {
                    homey: this.homey,
                });
                
                const apps = await api.apps.getApps();

                // Check each app defined in the object
                for (let [key, value] of Object.entries(apps))
                {
                    //console.log("Origin: ", value.origin, ";\tChannel: ", value.channel, ";\tUpdateAvailable: ", value.updateAvailable, ";\t", value.name);
                    this.homey.api.realtime('com.community.store.showUpdates', { 'checking': value.name });
                    if (communityData)
                    {
                        await this.compareCommunityStoreVersion(key, value, notify, communityData, notifiedList, updateList);
                    }
                    if (value.origin == 'appstore')
                    {
                        await this.compareAthomStoreVersion(key, value, notify, notifiedList, updateList);
                    }
                }

                // Wait for all the checks to complete
                //await Promise.allSettled(promises);

                this.homey.settings.set('updateList', updateList);
            }
            catch (err)
            {
                //console.log(err);
                status = err.message;
            }

            this.homey.settings.set('notifiedList', notifiedList);

            this.log("***** Check Complete *****");
            this.log(`Status: ${status}`);
            this.checking = false;
            this.homey.api.realtime('com.community.store.showUpdates', { 'status': status });
            return true;
        }

        return false;
    }

    // Compare version strings of the format x.x.x where x is a number >= 0
    // returns -1 if v1 < v2, 0 if v1 == v2 and 1 if v1 > v2
    compareVersions(v1, v2)
    {
        const vc1 = v1.split('.');
        const vc2 = v2.split('.');

        if (parseInt(vc1[0]) < parseInt(vc2[0])) return -1;
        if (parseInt(vc1[0]) > parseInt(vc2[0])) return 1;
        if (parseInt(vc1[1]) < parseInt(vc2[1])) return -1;
        if (parseInt(vc1[1]) > parseInt(vc2[1])) return 1;
        if (parseInt(vc1[2]) < parseInt(vc2[2])) return -1;
        if (parseInt(vc1[2]) > parseInt(vc2[2])) return 1;

        return 0;
    }

    // Returns an array of appId, version from the Community store
    async fetchCommunityVersions()
    {
        try
        {
            let appURL = "https://4c23v5xwtc.execute-api.eu-central-1.amazonaws.com/production/apps/latest";
            const options = {
                headers:
                {
                    'x-api-key': Homey.env.API_KEY
                }
            };
            const res = await this.GetURL(appURL, options);
            return JSON.parse(res).body;
        }
        catch (err)
        {
            console.log("Community store error: ", err);
        }
    }

    // Compare the app installed version to the Community store version
    async compareCommunityStoreVersion(AppId, AppData, Notify, communityData, notifiedList, updateList)
    {
        // get the Community store version information of the app
        let storeAppInfo = await this.getCommunityStoreAppInfo(AppId, communityData);

        // If the app was found in the store and is a different version, then process it
        if (storeAppInfo && (this.compareVersions(AppData.version, storeAppInfo.releaseVersion) == -1))
        {
            // The installed version is lower than the current version
            updateList.push(
            {
                url: "https://store.homey.community/app/" + AppId,
                name: AppData.name + " (" + storeAppInfo.releaseVersion + ")"
            });

            if (!this.checkNotifiedList(AppId, "Community", storeAppInfo.releaseVersion, notifiedList))
            {
                let data = "";
                if (Notify)
                {
                    data = "Community store: " + this.homey.__("Update_available_for") + AppData.name + this.homey.__("from") + AppData.version + this.homey.__("to") + storeAppInfo.releaseVersion;
                }
                this.fireUpdateTrigger(AppData.name, this.homey.__("community_store"), AppData.version, storeAppInfo.releaseVersion);

                if (Notify)
                {
                    this.homey.ManagerNotifications.registerNotification(
                    {
                        excerpt: data
                    }, (e, n) => {});
                }
            }
        }
    }

    // Get the version number for the specified app from the previously retrieved array
    async getCommunityStoreAppInfo(AppId, communityData)
    {
        if (communityData)
        {
            const appInfo = communityData.find(element => element.id == AppId);
            if (appInfo)
            {
                //console.log("App in Community store: ", appInfo.id, " - Version: ", appInfo.version);
                return {
                    releaseVersion: appInfo.version,
                    testVersion: appInfo.version
                };
            }
        }
        else
        {
            console.log("No Community store data");
        }

        return null;
    }

    // Compare the app installed version to the Athom store version
    async compareAthomStoreVersion(AppId, AppData, Notify, notifiedList, updateList)
    {
        // get the Athom store version information of the app
        let storeAppInfo = await this.getAthomStoreAppInfo(AppId, AppData.name);

        // If the app was found in the store and is a different version, then process it
        if (storeAppInfo)
        {
            //console.log("Athom store versions (", AppData.name, "), Test: ", storeAppInfo.testVersion, " - Release: ", storeAppInfo.releaseVersion);
            if (this.compareVersions(AppData.version, storeAppInfo.testVersion) == -1)
            {
                // The installed version is lower than the test version
                let data = "";
                if (this.compareVersions(AppData.version, storeAppInfo.releaseVersion) == -1)
                {
                    // The installed version is lower than the release version
                    if (!this.checkNotifiedList(AppId, "Athom-Production", storeAppInfo.releaseVersion, notifiedList))
                    {
                        if (Notify)
                        {
                            data = this.homey.__("Update_available_for") + AppData.name + this.homey.__("from") + AppData.version + this.homey.__("to") + storeAppInfo.releaseVersion;
                        }

                        this.fireUpdateTrigger(AppData.name, this.homey.__("athom_store"), AppData.version, storeAppInfo.releaseVersion);
                    }

                    const AppName = AppData.name.replace(/ /g, "-");
                    const url = encodeURI("https://homey.app/en-gb/app/" + AppId + "/" + AppName + "/");

                    updateList.push(
                    {
                        url: url,
                        name: AppData.name + " (" + storeAppInfo.releaseVersion + ")"
                    });

                }
                else
                {
                    if (!this.checkNotifiedList(AppId, "Athom-Test", storeAppInfo.testVersion, notifiedList))
                    {
                        if (Notify)
                        {
                            data = this.homey.__("Update_available_for") + AppData.name + this.homey.__("from") + AppData.version + this.homey.__("to") + " Test: " + storeAppInfo.testVersion;
                        }

                        this.fireUpdateTrigger(AppData.name, this.homey.__("athom_store"), AppData.version, "test " + storeAppInfo.testVersion);
                    }

                    let AppName = AppData.name.replace(/ /g, "-");
                    let url = encodeURI("https://homey.app/en-gb/app/" + AppId + "/" + AppName + "/test/");
                    updateList.push(
                    {
                        url: url,
                        name: AppData.name + " (test " + storeAppInfo.testVersion + ")"
                    });
                }

                if (data)
                {
                    this.homey.ManagerNotifications.registerNotification(
                    {
                        excerpt: data
                    }, (e, n) => {});
                }
            }

            storeAppInfo = null;
        }
    }

    // Get information about the app in the Athom store
    // If there is no test version then both version numbers will be the same
    async getAthomStoreAppInfo(AppId, AppName)
    {
        const regex = /(?<=hy_app_version=)(\d|\.)*/;
        const regexTest = /(?<=hy-app-version=")(\d|\.)*/;

        let res = null;
        let rv = "";
        let tv = "";

        AppName = AppName.replace(/ /g, "-");
        let appURL = encodeURI("https://homey.app/en-gb/app/" + AppId + "/" + AppName + "/");
        res = await this.GetURLorRedirect(appURL, {});

        if (res)
        {
            const v = regex.exec(res.res)[0];
            const url = res.url;
            rv = `${v}`;
            tv = rv;
            appURL = `${url}`;
        }
        else
        {
            //("Failed to get ", AppName, " -> ", appURL);
        }

        try
        {
            // try the test version, which may not exist
            res = await this.GetURLorRedirect(appURL + "test/", {});
            if (res)
            {
                const v = regexTest.exec(res.res)[0];
                tv = `${v}`;
                //console.log( "App test version = ", AppName, " tv = ", tv);
            }
        }
        catch (err)
        {
            // Don't worry if this fails as it is expected when there is no test version
            if (err.source === "HTTPS Error" && err.code !== 302)
            {
                //console.log(err);
            }
        }

        res = null;

        return {
            releaseVersion: rv,
            testVersion: tv
        };
    }

    // Send request to the community store to updated the app
    async updateCommunityStoreApp(AppId)
    {
        // TODO Send request to community store to update an app

        return this.homey.__("Store_not_available"); // Update failed
    }

    async GetURLorRedirect(url, Options)
    {
        let urlToUse = url;
        try
        {
            return { url: urlToUse, res: await this.GetURL(urlToUse, Options) };
        }
        catch (err)
        {
            if (err.source === "HTTPS Error" && err.code === 302)
            {
                // Try again with the redirect location
                urlToUse = "https://homey.app" + err.message;
            }
            else
            {
                return null;
            }
        }

        try
        {
            return { url: urlToUse, res: await this.GetURL(urlToUse, Options) };
        }
        catch (err)
        {

        }

        return null;
    }

    async GetURL(url, Options)
    {
        return new Promise((resolve, reject) =>
        {
            try
            {
                //console.log("Checking: ", url);
                https.get(url, Options, (res) =>
                {
                    let body = [];
                    res.on('data', (chunk) =>
                    {
                        body.push(chunk);
                    });
                    res.on('end', () =>
                    {
                        if (res.statusCode === 200)
                        {
                            resolve(
                                Buffer.concat(body).toString()
                            );
                        }
                        else
                        {
                            let message = "";
                            if (res.statusCode === 204)
                            {
                                message = "No Data Found";
                            }
                            else if (res.statusCode === 302)
                            {
                                message = res.headers.location;
                            }
                            else if (res.statusCode === 400)
                            {
                                message = "Bad request";
                            }
                            else if (res.statusCode === 401)
                            {
                                message = "Unauthorized";
                            }
                            else if (res.statusCode === 403)
                            {
                                message = "Forbidden";
                            }
                            else if (res.statusCode === 404)
                            {
                                message = "Not Found";
                            }
                            reject({ source: "HTTPS Error", code: res.statusCode, message: message });
                        }
                    });
                }).on('error', (err) =>
                {
                    //console.log("HTTPS Catch: ", err);
                    reject({ source: "HTTPS Catch", err: err });
                }).on('timeout', (err) =>
                {
                    //console.log("HTTPS Catch: ", err);
                    reject({ source: "HTTPS Catch", err: err });
                });
            }
            catch (e)
            {
                //console.log(e);
                reject({ source: "HTTPS Try Catch", err: e });
            }
        });
    }
}

module.exports = MyApp;