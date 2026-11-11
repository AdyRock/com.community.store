/* jslint node: true */

'use strict';

module.exports = {

    async CheckNow({ homey })
    {
        //method: 'POST',
        homey.app.checkNow(false).catch(err =>
        {
            homey.app.error("Manual update check failed", err);
        });
        return;
    },
    async SetTime({ homey })
    {
        //method: 'POST',
        return homey.app.updateTimeout();
    }
};