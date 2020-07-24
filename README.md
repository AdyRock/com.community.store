# Community Store Checker

Check for app updates in the Athom Store and the HCS (Homey Community Store)

This app scans the Athom store and the HCS for all your installed apps and checks the version numbers in both release and test.
You can set an option to notify you in the Timeline once per day or you can manually check in the configuration page.
The configuration page also has buttons for each update to take you to the relevant store page for the app so you can install the new version.
There is also a flow trigger card that fires when new updates are available.

If you install from the CLI using the GitHub repository you will need to run npm update to install the node_modules.
Also the app will only check the Athom store as the secret api keys required for the HCS are not included.
