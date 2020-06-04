'use strict';

const Homey = require('homey');
const HomeyAPI = require('athom-api').HomeyAPI;
const https = require("https");

const UPDATE_INTERVAL = (1000 * 60 * 60 * 23);

class MyApp extends Homey.App {

	onInit() {
		this.log('MyApp is running...');

		// Do first check for updates after 5 seconds so the app has a chance to load
		setTimeout(this.checkForUpdates.bind(this), 5000);
	};

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
		this.log("checkForUpdates");

		// Get the list of installed apps
		const api = await HomeyAPI.forCurrentHomey();
		let apps = await api.apps.getApps();
		let promises = [];

		// Check each app defined in the object
		for (let [key, value] of Object.entries(apps)) {
			promises.push(this.compareStoreVersion(key, value, notify, update));
		}

		// Wait for all the checks to complete
		await Promise.all(promises);
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

	// Compare the app installed version to the store version
	async compareStoreVersion(AppId, AppData, Notify, Update) {
		console.log(AppId, " (", AppData.name + "): ", AppData.version);

		// get the store version information of the app
		let storeAppInfo = await this.getAthomStoreAppInfo(AppId, AppData.name);

		// If the app was found in the community store and is a different version, then process it
		if (storeAppInfo && (this.compareVersions(AppData.version, storeAppInfo.testVersion) == -1)) {
			// The installed version is lower than the test version
			if (Notify) {
				let data = "";
				if (this.compareVersions(AppData.version, storeAppInfo.releaseVersion) == -1) {
					data = Homey.__("Update_available_for") + AppData.name + Homey.__("from") + AppData.version + Homey.__("to") + storeAppInfo.releaseVersion;
				} else {
					data = Homey.__("Update_available_for") + AppData.name + Homey.__("from") + AppData.version + Homey.__("to") + " Test: " + storeAppInfo.testVersion;
				}

				Homey.ManagerNotifications.registerNotification({
					excerpt: data
				}, (e, n) => {});
			}

			if (Update && (this.compareVersions(AppData.version, storeAppInfo.releaseVersion) == -1)) {
				// The installed version is lower than the release version
				// Ask the community store to update the app
				const err = await this.updateCommunityStoreApp(AppId);
				if (err) {
					const data = Homey.__("Failed_to_update") + AppData.name + " (" + err + ")";
					Homey.ManagerNotifications.registerNotification({
						excerpt: data
					}, (e, n) => {});
				} else {
					const data = AppData.name + Homey.__("updated_from") + AppData.version + Homey.__("to") + storeAppInfo.version;
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
			let res = await this.GetURL(appURL);
			let rv = regex.exec(res)[0];
			let tv = rv;

			try {
				// try the test version, which may not exist
				res = await this.GetURL(appURL + "test/");
				tv = regexTest.exec(res)[0];
			} catch (err) {
				// Don't worry if this fails as it is expected when there is no test version
			}

			return {
				releaseVersion: rv,
				testVersion: tv
			};

		} catch (err) {
			this.log(AppId, ": ", err);
		}

		return null;
	}

	// Send request to the community store to updated the app
	async updateCommunityStoreApp(AppId) {
		// TODO Send request to community store to update an app

		return Homey.__("Store_not_available"); // Update failed
	}

	async GetURL(url) {
		return new Promise((resolve, reject) => {
			try {
				https.get(url, (res) => {
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
					this.log("HTTPS Catch: " + err);
					reject("HTTPS Catch: " + err);
				});
			} catch (e) {
				this.log(e);
				reject("HTTPS Error: " + e);
			}
		});
	}

	addSomething(body) {

	}
}

module.exports = MyApp;