'use strict';

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

		// Do first check for updates after 5 seconds so the app has a chance to load
		setTimeout(this.checkForUpdates.bind(this), 5000);
	};

	firUpdateTrigger(Name, OldVersion, NewVersion) {
		let appUpdateTrigger = new Homey.FlowCardTrigger('update_available');
		let tokens = {
			'update_app_name': Name,
			'update_app_old_ver': OldVersion,
			'update_app_new_ver': NewVersion
		}
		appUpdateTrigger
			.register()
			.trigger(tokens)
			.catch(this.error)
			.then(this.log);

	}

	// Check each installed app against the community store to determine if any updates are available
	async checkForUpdates() {
		// Get the app settings
		let notify = Homey.ManagerSettings.get('autoNotify');
		let update = Homey.ManagerSettings.get('autoUpdate');

		// No need to go through the apps if neither option is set
		if (notify || update) {
			if (await this.checkNow(notify, update)) {
				// Setup timer for next check
				setTimeout(this.checkForUpdates.bind(this), UPDATE_INTERVAL);
			}
		}
	}

	async checkNow(notify, update) {
		if (!this.checking) {
			this.checking = true;
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
					//console.log("Checking: ", key, " (", value.name + ") Current version: ", value.version);
					promises.push(this.compareCommunityStoreVersion(key, value, notify, update));
					promises.push(this.compareAthomStoreVersion(key, value, notify, update));
				}

				// Wait for all the checks to complete
				await Promise.all(promises);

				Homey.ManagerSettings.set('updateList', this.updateList);
				this.updateList = [];
			} catch (err) {
				console.log(err);
			}
			this.log("***** Check Complete *****");
			this.checking = false;
		}
	}

	// Compare version strings of the format x.x.x where x is a number >= 0
	// returns -1 if v1 < v2, 0 if v1 == v2 and 1 if v1 > v2
	compareVersions(v1, v2) {
		let vc1 = v1.split('.');
		let vc2 = v2.split('.');

		if (vc1[0] < vc2[0]) return -1;
		if (vc1[0] > vc2[0]) return 1;
		if (vc1[1] < vc2[1]) return -1;
		if (vc1[1] > vc2[1]) return 1;
		if (vc1[2] < vc2[2]) return -1;
		if (vc1[2] > vc2[2]) return 1;

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
			let data = "";
			if (Notify) {
				data = "Community store: " + Homey.__("Update_available_for") + AppData.name + Homey.__("from") + AppData.version + Homey.__("to") + storeAppInfo.releaseVersion;
			}
			this.updateList.push({
				url: "https://store.homey.community/app/" + AppId,
				name: AppData.name + " (" + storeAppInfo.releaseVersion + ")"
			})

			this.firUpdateTrigger(AppData.name, AppData.version, storeAppInfo.releaseVersion);

			if (Notify) {
				Homey.ManagerNotifications.registerNotification({
					excerpt: data
				}, (e, n) => {});
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
					if (Notify) {
						data = Homey.__("Update_available_for") + AppData.name + Homey.__("from") + AppData.version + Homey.__("to") + storeAppInfo.releaseVersion;
					}
					let AppName = AppData.name.replace(/ /g, "-");
					this.updateList.push({
						url: "https://homey.app/en-gb/app/" + AppId + "/" + AppName + "/",
						name: AppData.name + " (" + storeAppInfo.releaseVersion + ")"
					})

					this.firUpdateTrigger(AppData.name, AppData.version, storeAppInfo.releaseVersion);

				} else {
					if (Notify) {
						data = Homey.__("Update_available_for") + AppData.name + Homey.__("from") + AppData.version + Homey.__("to") + " Test: " + storeAppInfo.testVersion;
					}
					let AppName = AppData.name.replace(/ /g, "-");
					this.updateList.push({
						url: "https://homey.app/en-gb/app/" + AppId + "/" + AppName + "/test/",
						name: AppData.name + " (test " + storeAppInfo.testVersion + ")"
					})

					this.firUpdateTrigger(AppData.name, AppData.version, storeAppInfo.testVersion);
				}

				if (Notify) {
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

	addSomething(body) {

	}
}

module.exports = MyApp;