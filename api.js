/* jslint node: true */

'use strict';

module.exports = {

    async CheckNow({ homey })
    {
        //method: 'POST',
        homey.app.checkNow(false, false);
        return;
    },
    async SetTime({ homey })
    {
        //method: 'POST',
        return homey.app.updateTimeout();
    }
};