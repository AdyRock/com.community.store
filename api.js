/* jslint node: true */

'use strict';

module.exports = {

    async CheckNow({ homey })
    {
        //method: 'POST',
        return homey.app.checkNow(false, false);
    },
    async SetTime({ homey })
    {
        //method: 'POST',
        return homey.app.updateTimeout();
    }
};