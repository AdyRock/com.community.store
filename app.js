'use strict';

if (process.env.DEBUG === '1') {
	require('inspector').open(9222, '0.0.0.0')
}

const Homey = require('homey');
const HomeyAPI = require('athom-api').HomeyAPI;
const https = require("https");

const UPDATE_INTERVAL = (1000 * 60 * 60 * 23);

class MyApp extends Homey.App {

	onInit() {
		this.log('MyApp is running...');
		this.checking = false;

		this.updateList = [];
		Homey.ManagerSettings.set('updateList', this.updateList);

		this.notifiedList = Homey.ManagerSettings.get('notifiedList');
		if (!this.notifiedList) {
			this.notifiedList = [];
		}

		this.updateHr = Homey.ManagerSettings.get('updateHr');
		this.updateMin = Homey.ManagerSettings.get('updateMin');

		if (!this.updateHr) {
			this.updateHr = 8;
			this.updateMin = 0;
			Homey.ManagerSettings.set('updateHr', this.updateHr);
			Homey.ManagerSettings.set('updateMin', this.updateMin);
		}

		// Do first check for updates after 30 seconds so the app has a chance to load
		setTimeout(this.checkForUpdates.bind(this), 30000);
	};

	async fireUpdateTrigger(Name, Store, OldVersion, NewVersion) {
		let appUpdateTrigger = new Homey.FlowCardTrigger('update_available');
		let tokens = {
			'update_app_name': Name,
			"update_app_store": Store,
			'update_app_old_ver': OldVersion,
			'update_app_new_ver': NewVersion
		}
		appUpdateTrigger
			.register()
			.trigger(tokens)
			.catch(this.error)
			.then(this.log("Trigger Complete"));
	}

	// Returns true if this app version has already been checked
	checkNotifiedList(AppId, Source, Version) {
		const appIndex = this.notifiedList.findIndex(element => (element.Id == AppId) && (element.Source == Source));
		if (appIndex >= 0) {
			// An entry for this app has been found so check if it is the same version as already reported
			if (this.notifiedList[appIndex].Version == Version)  {
				// Version matched previous check
				console.log( "App: ", AppId, " Version: ", Version, " From: ", Source, " Already notified.")
				return true;
			}

			// Different version to previous check so update the array values
			this.notifiedList[appIndex].Version = Version;
			return false;
		}

		// App not in the list so it has not been checked yet
		let newAppInfo = {
			'Id': AppId,
			'Source': Source,
			'Version': Version,
		}

		this.notifiedList.push(newAppInfo);

		return false;
	}

	// Check each installed app against the community store to determine if any updates are available
	async checkForUpdates() {
		// Get the app settings
		let notify = Homey.ManagerSettings.get('autoNotify');
		let update = Homey.ManagerSettings.get('autoUpdate');

		if (await this.checkNow(notify, update)) {
			this.updateTimeout()
		}
	}

	updateTimeout() {
		if (this.timeoutID) {
			clearTimeout(this.timeoutID);
		}

		// Calculate the time until the required check time
		this.updateHr = Homey.ManagerSettings.get('updateHr');
		this.updateMin = Homey.ManagerSettings.get('updateMin');
		const nowTime = new Date(Date.now());
		let newTime = new Date(Date.now());
		if (nowTime.getHours() > this.updateHr) {
			// next time is tomorrow
			newTime.setDate(newTime.getDate() + 1);
		} else if ((nowTime.getHours() == this.updateHr) && (nowTime.getMinutes() >= this.updateMin)) {
			// next time is tomorrow
			newTime.setDate(newTime.getDate() + 1);
		}

		newTime.setHours(this.updateHr);
		newTime.setMinutes(this.updateMin);
		newTime = newTime - nowTime;

		console.log("Next check in (ms): ", newTime.valueOf())

		// Setup timer for next check
		this.timeoutID = setTimeout(this.checkForUpdates.bind(this), newTime.valueOf());
	}

	async checkNow(notify, update) {
		if (!this.checking) {
			this.checking = true;
			let status = "";
			try {
				this.log("Check for updates");

				// Get the array of apps and version numbers from the Community store
				this.communityPromise = this.fetchCommunityVersions();
				this.updateList = [];

				// Get the list of installed apps
				const api = await HomeyAPI.forCurrentHomey();
				let apps = await api.apps.getApps();
				let promises = [];

				// Check each app defined in the object
				for (let [key, value] of Object.entries(apps)) {
					//console.log("Origin: ", value.origin, ";\tChannel: ", value.channel, ";\tUpdateAvailable: ", value.updateAvailable, ";\t", value.name);
					promises.push(this.compareCommunityStoreVersion(key, value, notify, update));
					if (value.origin == 'appstore') {
						promises.push(this.compareAthomStoreVersion(key, value, notify, update));
					}
				}

				// Wait for all the checks to complete
				await Promise.allSettled(promises);

				Homey.ManagerSettings.set('updateList', this.updateList);
				this.updateList = [];
			} catch (err) {
				console.log(err);
				status = err.message;
			}

			Homey.ManagerSettings.set('notifiedList', this.notifiedList);

			this.log("***** Check Complete *****");
			this.checking = false;
			Homey.ManagerApi.realtime('com.community.store.showUpdates', {'status': status});	
			return true;
		}

		return false;
	}

	// Compare version strings of the format x.x.x where x is a number >= 0
	// returns -1 if v1 < v2, 0 if v1 == v2 and 1 if v1 > v2
	compareVersions(v1, v2) {
		let vc1 = v1.split('.');
		let vc2 = v2.split('.');

		if (parseInt(vc1[0]) < parseInt(vc2[0])) return -1;
		if (parseInt(vc1[0]) > parseInt(vc2[0])) return 1;
		if (parseInt(vc1[1]) < parseInt(vc2[1])) return -1;
		if (parseInt(vc1[1]) > parseInt(vc2[1])) return 1;
		if (parseInt(vc1[2]) < parseInt(vc2[2])) return -1;
		if (parseInt(vc1[2]) > parseInt(vc2[2])) return 1;

		return 0;
	}

	// Fetches an array of appId, version from the Community store and put it in this.communityData
	async fetchCommunityVersions() {
		try {
			this.communityData = [];
			let appURL = "https://4c23v5xwtc.execute-api.eu-central-1.amazonaws.com/production/apps/latest";
			const options = {
				headers: {
					'x-api-key': Homey.env.API_KEY
				}
			}
			let res = await this.GetURL(appURL, options);
			this.communityData = JSON.parse(res).body;
			//console.log("Community Data: ", this.communityData);
		} catch (err) {
			console.log("Community store error: ", err);
		}
	}

	// Compare the app installed version to the Community store version
	async compareCommunityStoreVersion(AppId, AppData, Notify, Update) {

		await this.communityPromise;

		//console.log("Checking Community store for: ", AppId);

		// get the Community store version information of the app
		let storeAppInfo = await this.getCommunityStoreAppInfo(AppId, AppData.name);

		// If the app was found in the store and is a different version, then process it
		if (storeAppInfo && (this.compareVersions(AppData.version, storeAppInfo.releaseVersion) == -1)) {
			// The installed version is lower than the current version
			this.updateList.push({
				url: "https://store.homey.community/app/" + AppId,
				name: AppData.name + " (" + storeAppInfo.releaseVersion + ")"
			})

			if (!this.checkNotifiedList(AppId, "Community", storeAppInfo.releaseVersion)) {
				let data = "";
				if (Notify) {
					data = "Community store: " + Homey.__("Update_available_for") + AppData.name + Homey.__("from") + AppData.version + Homey.__("to") + storeAppInfo.releaseVersion;
				}
				this.fireUpdateTrigger(AppData.name, Homey.__("community_store"), AppData.version, storeAppInfo.releaseVersion);

				if (Notify) {
					Homey.ManagerNotifications.registerNotification({
						excerpt: data
					}, (e, n) => {});
				}
			}

			// if (Update && (this.compareVersions(AppData.version, storeAppInfo.releaseVersion) == -1)) {
			// 	// The installed version is lower than the current version
			// 	// Ask the community store to update the app
			// 	const err = await this.updateCommunityStoreApp(AppId);
			// 	if (err) {
			// 		const data = Homey.__("Failed_to_update") + AppData.name + " (" + err + ")";
			// 		Homey.ManagerNotifications.registerNotification({
			// 			excerpt: data
			// 		}, (e, n) => {});
			// 	} else {
			// 		const data = AppData.name + Homey.__("updated_from") + AppData.version + Homey.__("to") + storeAppInfo.version;
			// 		Homey.ManagerNotifications.registerNotification({
			// 			excerpt: data
			// 		}, (e, n) => {});
			// 	}
			// }
		}
	}

	// Get the version number for the specified app from the previously retrieved array
	async getCommunityStoreAppInfo(AppId) {
		if (this.communityData) {
			const appInfo = this.communityData.find(element => element.id == AppId);
			if (appInfo) {
				//console.log("App in Community store: ", appInfo.id, " - Version: ", appInfo.version);
				return {
					releaseVersion: appInfo.version,
					testVersion: appInfo.version
				};
			}
			// else{
			// 	console.log("App not in Community store");
			// }
		}
		// else{
		// 	console.log("No Community store data");
		// }

		return null;
	}


	// Compare the app installed version to the Athom store version
	async compareAthomStoreVersion(AppId, AppData, Notify, Update) {
		// get the Athom store version information of the app
		let storeAppInfo = await this.getAthomStoreAppInfo(AppId, AppData.name);

		// If the app was found in the store and is a different version, then process it
		if (storeAppInfo) {
			//console.log("Athom store versions, Test: ", storeAppInfo.testVersion, " - Release: ", storeAppInfo.releaseVersion);
			if (this.compareVersions(AppData.version, storeAppInfo.testVersion) == -1) {
				// The installed version is lower than the test version
				let data = "";
				if (this.compareVersions(AppData.version, storeAppInfo.releaseVersion) == -1) {
					// The installed version is lower than the release version
					if (!this.checkNotifiedList(AppId, "Athom-Production", storeAppInfo.releaseVersion)) {
						if (Notify) {
							data = Homey.__("Update_available_for") + AppData.name + Homey.__("from") + AppData.version + Homey.__("to") + storeAppInfo.releaseVersion;
						}

						this.fireUpdateTrigger(AppData.name, Homey.__("athom_store"), AppData.version, storeAppInfo.releaseVersion);
					}

					let AppName = AppData.name.replace(/ /g, "-");
					this.updateList.push({
						url: "https://homey.app/en-gb/app/" + AppId + "/" + AppName + "/",
						name: AppData.name + " (" + storeAppInfo.releaseVersion + ")"
					})

				} else {
					if (!this.checkNotifiedList(AppId, "Athom-Test", storeAppInfo.testVersion)) {
						if (Notify) {
							data = Homey.__("Update_available_for") + AppData.name + Homey.__("from") + AppData.version + Homey.__("to") + " Test: " + storeAppInfo.testVersion;
						}

						this.fireUpdateTrigger(AppData.name, Homey.__("athom_store"), AppData.version, "test " + storeAppInfo.testVersion);
					}

					let AppName = AppData.name.replace(/ /g, "-");
					this.updateList.push({
						url: "https://homey.app/en-gb/app/" + AppId + "/" + AppName + "/test/",
						name: AppData.name + " (test " + storeAppInfo.testVersion + ")"
					})
				}

				if (data) {
					Homey.ManagerNotifications.registerNotification({
						excerpt: data
					}, (e, n) => {});
				}
			}
		}
	}

	// Get information about the app in the Athom store
	// If there is no test version then both version numbers will be the same
	async getAthomStoreAppInfo(AppId, AppName) {
		// TODO Fetch app information from community store

		try {
			const regex = /(?<=hy_app_version=)(\d|\.)*/;
			const regexTest = /(?<=hy-app-version=")(\d|\.)*/;

			AppName = AppName.replace(/ /g, "-");
			let appURL = "https://homey.app/en-gb/app/" + AppId + "/" + AppName + "/";
			const options = {};
			let res = await this.GetURL(appURL, options);
			let rv = regex.exec(res)[0];
			let tv = rv;

			try {
				// try the test version, which may not exist
				res = await this.GetURL(appURL + "test/", options);
				tv = regexTest.exec(res)[0];
			} catch (err) {
				// Don't worry if this fails as it is expected when there is no test version
			}

			return {
				releaseVersion: rv,
				testVersion: tv
			};

		} catch (err) {
			console.log("Athom store error: ", AppId, ": ", err);
		}

		return null;
	}

	// Send request to the community store to updated the app
	async updateCommunityStoreApp(AppId) {
		// TODO Send request to community store to update an app

		return Homey.__("Store_not_available"); // Update failed
	}

	async GetURL(url, Options) {
		return new Promise((resolve, reject) => {
			try {
				https.get(url, Options, (res) => {
					if (res.statusCode === 200) {
						let body = [];
						res.on('data', (chunk) => {
							body.push(chunk);
						});
						res.on('end', () => {
							resolve(
								Buffer.concat(body).toString()
							);
						});
					} else {
						let message = "";
						if (res.statusCode === 204) {
							message = "No Data Found";
						} else if (res.statusCode === 400) {
							message = "Bad request";
						} else if (res.statusCode === 401) {
							message = "Unauthorized";
						} else if (res.statusCode === 403) {
							message = "Forbidden";
						} else if (res.statusCode === 404) {
							message = "Not Found";
						}
						reject("HTTPS Error: " + res.statusCode + ", " + message);
					}
				}).on('error', (err) => {
					console.log("HTTPS Catch: " + err);
					reject("HTTPS Catch: " + err);
				});
			} catch (e) {
				console.log(e);
				reject("HTTPS Error: " + e);
			}
		});
	}
}

module.exports = MyApp;