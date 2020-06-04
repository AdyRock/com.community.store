const Homey = require( 'homey' );

module.exports = [

    //  {
    //     method: 'GET',
    //     path: '/',
    //     public: true,
    //     fn: function( args, callback ){
    //       const result = Homey.app.getSomething();

    //       // callback follows ( err, result )
    //       callback( null, result );

    //       // access /?foo=bar as args.query.foo
    //     }
    //   },

    {
        method: 'POST',
        path: '/CheckNow/',
        fn: function (args, callback) {
            Homey.app.checkNow(true, false);
            return callback(null, "ok");
        }
    }

    //   {
    //     method: 'PUT',
    //     path: '/:id',
    //     fn: function( args, callback ){
    //       const result = Homey.app.updateSomething( args.params.id, args.body );
    //       if( result instanceof Error ) return callback( result );
    //       return callback( null, result );
    //     }
    //   },

    //   {
    //     method: 'DELETE',
    //     path: '/:id',
    //     fn: function( args, callback ){
    //       const result = Homey.app.deleteSomething( args.params.id );
    //       if( result instanceof Error ) return callback( result );
    //       return callback( null, result );
    //     }
    //   }

]