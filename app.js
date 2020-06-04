'use strict';

const Homey = require('homey');
const HomeyAPI = require('athom-api').HomeyAPI;

const UPDATE_INTERVAL = (1000 * 60 * 60 * 23);

class MyApp extends Homey.App {

	onInit() {
		this.log('MyApp is running...');

		// Do first check for updates after 5 seconds so the app has a chance to load
		setTimeout(this.checkForUpdates.bind(this), 5000);
	};

	// Check each installed app against the community store to determine if any updates are available
	async checkForUpdates() {
		this.log("checkForUpdates");

		// Get the app settings
		let notify = Homey.ManagerSettings.get('autoNotify');
		let update = Homey.ManagerSettings.get('autoUpdate');

		// No need to go through the apps if neither option is set
		if (notify || update) {
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

			// Setup timer for next check
			setTimeout(this.checkForUpdates.bind(this), UPDATE_INTERVAL);
		}
	}

	// Compare the app installed version to the store version
	async compareStoreVersion(AppId, AppData, Notify, Update) {
		console.log(AppId, ": ", AppData.version);

		// get store version of the app
		let storeApp = await this.getCommunityStoreAppInfo(AppId);

		// If the app was found in the community store and is a different version, then process it
		if (storeApp && (AppData.version != storeApp.version)) {
			if (Notify) {
				
				const data = Homey.__("Update_available_for") + AppData.name + Homey.__("from") + AppData.version + Homey.__("to") + storeApp.version;
				Homey.ManagerNotifications.registerNotification({
					excerpt: data
				}, (e, n) => {});
			}

			if (Update) {
				// Ask the community store to update the app
				const err = await this.updateCommunityStoreApp(AppId);
				if (err) {
					const data = Homey.__("Failed_to_update") + AppData.name + " (" + err + ")";
					Homey.ManagerNotifications.registerNotification({
						excerpt: data
					}, (e, n) => {});
				} else {
					const data = AppData.name + Homey.__("updated_from") + AppData.version + Homey.__("to") + storeApp.version;
					Homey.ManagerNotifications.registerNotification({
						excerpt: data
					}, (e, n) => {});
				}
			}
		}
	}

	// Get information about the app in the community store
	async getCommunityStoreAppInfo(AppId) {
		// TODO Fetch app information from community store

		// Test code only. Remove when proper store API defined
		if (AppId == 'com.soma.connect') {
			return {
				version: '1.0.2'
			};
		}
		// End of test code

		return null;
	}

	// Send request to the community store to updated the app
	async updateCommunityStoreApp(AppId) {
		// TODO Send request to community store to update an app

		return Homey.__("Store_not_available"); // Update failed
	}
}

module.exports = MyApp;