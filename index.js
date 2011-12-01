var poolModule = require('generic-pool'),
	mysql = require('db-mysql');

function SessionStore(connect, options) {
    connect.session.Store.call(this, options);
    SessionStore.prototype.__proto__ = connect.session.Store.prototype;
    
    var pool = poolModule.Pool({
        name: 'mysql-session-store',
        max: 10,
        idleTimeoutMillis : 30000,
        log : false,
        create: function(callback) {
            new mysql.Database(options).connect(function(err, server) {
                callback(err, this);
            });
        },
        destroy: function(db) {
            db.disconnect();
        }
    });

    pool.acquire(function(err, db) {
        if (err) { throw err; }
        db.query().execute("CREATE  TABLE IF NOT EXISTS `_mysql_session_store` (`id` VARCHAR(255) NOT NULL, `expires` INT NULL, `data` TEXT NULL, PRIMARY KEY (`id`));",
            function(error, rows, cols){
                pool.release(db);
                if(error){ throw error; }
            });
    });

    // every minute go and burn the old sessions
    var checkUpInterval = typeof(options.checkUpInterval) == "undefined" ? 60000 : options.checkUpInterval;
    if(checkUpInterval > 0) {
        setInterval(function(){
            pool.acquire(function(err, db) {
                if (err) { throw err; }
                var now = new Date();
                now = now.valueOf();
                db.query().delete().from('_mysql_session_store').where('expires < ?', [now]).execute(function(e){
                    pool.release(db);
                });
            });
        }, checkUpInterval);
    }

    this.pool = pool;
}


SessionStore.prototype.get = function(sid, callback) {
    var pool = this.pool;
    pool.acquire(function(err, db) {
        if (err) { throw err; }
        db.query()
            .select('*')
            .from('_mysql_session_store')
            .where("id = ?", [sid])
            .execute(function(e, rows) {
                pool.release(db);
                if(e){
                    callback(e, null);
                }else if(rows.length == 0){
                    callback();
                }else {
                    var session = JSON.parse(rows[0].data);
                    callback(null, session);
                }
            });
    });
};

SessionStore.prototype.set = function(sid, session, callback) {
    var pool = this.pool;
    pool.acquire(function(err, db) {
        if (err) { throw err; }
        var expires = 'string' == typeof session.cookie.expires
                        ? new Date(session.cookie.expires)
                        : session.cookie.expires;
        expires = expires.valueOf();
        var data = JSON.stringify(session);
        db.query()
            .execute("INSERT INTO _mysql_session_store(id, expires, data) VALUES(?, ?, ?) ON DUPLICATE KEY UPDATE expires=?, data =?",
                            [sid, expires, data, expires, data], 
            function(e){
                pool.release(db);
                callback(e);
            });
    });
};

SessionStore.prototype.destroy = function(sid, callback) {
    var pool = this.pool;
    pool.acquire(function(err, db) {
        if (err) { throw err; }
        db.query().delete().from('_mysql_session_store').where('id = ?', [sid]).execute(function(e){
            pool.release(db);
            callback && callback(e ? e : null);
        });
    });
};

SessionStore.prototype.clear = function(callback) {
    var pool = this.pool;
    pool.acquire(function(err, db) {
        if (err) { throw err; }
        db.query().delete().from('_mysql_session_store').execute(function(e){
            pool.release(db);
            callback(e);
        });
    });
};

// not implementing .length and .all because I can't see them being using in connect.

module.exports = SessionStore;
