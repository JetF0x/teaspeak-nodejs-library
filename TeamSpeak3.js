/**
 * @file TeamSpeak3.js
 * @ignore
 * @copyright David Kartnaller 2017
 * @license GNU GPLv3
 * @author David Kartnaller <david.kartnaller@gmail.com>
 */

const TS3Query = require(__dirname+"/transport/TS3Query")
const FileTransfer = require(__dirname+"/transport/FileTransfer")
const TeamSpeakClient = require(__dirname+"/property/Client")
const TeamSpeakChannel = require(__dirname+"/property/Channel")
const TeamSpeakServer = require(__dirname+"/property/Server")
const TeamSpeakServerGroup = require(__dirname+"/property/ServerGroup")
const TeamSpeakChannelGroup = require(__dirname+"/property/ChannelGroup")

const EventEmitter = require("events")

/**
 * Main TeamSpeak Query Class
 * @fires TeamSpeak3#ready
 * @fires TeamSpeak3#error
 * @fires TeamSpeak3#close
 * @fires TeamSpeak3#channeldelete
 * @fires TeamSpeak3#channelmoved
 * @fires TeamSpeak3#channelcreate
 * @fires TeamSpeak3#channeledit
 * @fires TeamSpeak3#serveredit
 * @fires TeamSpeak3#clientmoved
 * @fires TeamSpeak3#textmessage
 * @fires TeamSpeak3#clientdisconnect
 * @fires TeamSpeak3#clientconnect
 */
class TeamSpeak3 extends EventEmitter {
    /**
     * Represents a TeamSpeak Server Instance
     * @version 1.0
     * @param {object} [config] - The Configuration Object
     * @param {string} [config.protocol=raw] - The Protocol to use, valid is ssh or raw
     * @param {string} [config.host=127.0.0.1] - The Host on which the TeamSpeak Server runs
     * @param {number} [config.queryport=10011] - The Queryport on which the TeamSpeak Server runs
     * @param {number} [config.serverport=9987] - The Serverport on which the TeamSpeak Instance runs
     * @param {string} [config.username] - The username to authenticate with the TeamSpeak Server
     * @param {string} [config.password] - The password to authenticate with the TeamSpeak Server
     * @param {string} [config.nickname] - The Nickname the Client should have
     * @param {boolean} [config.antispam=false] - Whether the AntiSpam should be activated or deactivated
     * @param {number} [config.antispamtimer=350] - The time between every command for the antispam (in ms)
     * @param {boolean} [config.keepalive=true] - Whether the Query should send a keepalive
     */
    constructor(config = {}) {
        super()
        this._config = {
            protocol: config.protocol || "raw",
            host: config.host || "127.0.0.1",
            queryport: parseInt(config.queryport) || 10011,
            serverport: parseInt(config.serverport) || false,
            username: config.username || false,
            password: config.password || false,
            nickname: config.nickname || false,
            antispam: Boolean(config.antispam),
            antispamtimer: parseInt(config.antispamtimer) || 350,
            keepalive: Boolean(config.keepalive)
        }

        this._clients = {}
        this._channels = {}
        this._servergroups = {}
        this._channelgroups = {}
        this._servers = {}

        this._ts3 = new TS3Query(
          this._config.host,
          this._config.queryport,
          this._config.protocol,
          this._config.username,
          this._config.password
        )

        if (this._config.keepalive) this._ts3.keepAlive()
        if (this._config.antispam) this._ts3.antiSpam(this._config.antispamtimer)

        this._ts3.on("cliententerview", this._evcliententerview.bind(this))
        this._ts3.on("clientleftview", this._evclientleftview.bind(this))
        this._ts3.on("serveredited", this._evserveredited.bind(this))
        this._ts3.on("channeledited", this._evchanneledited.bind(this))
        this._ts3.on("channelmoved", this._evchannelmoved.bind(this))
        this._ts3.on("channeldeleted", this._evchanneldeleted.bind(this))
        this._ts3.on("channelcreated", this._evchannelcreated.bind(this))
        this._ts3.on("clientmoved", this._evclientmoved.bind(this))
        this._ts3.on("textmessage", this._evtextmessage.bind(this))

        this._ts3.on("connect", () => {
            var exec = []
            if (typeof this._config.username === "string" && this._config.protocol === "raw")
                exec.push(this.login(this._config.username, this._config.password))
            if (typeof this._config.serverport === "number")
                exec.push(this.useByPort(this._config.serverport))
            if (typeof this._config.nickname === "string")
                exec.push(this.clientUpdate({client_nickname: this._config.nickname}))
            Promise.all(exec)
                /**
                 * Query Ready Event
                 * Gets fired when the TeamSpeak Query has successfully connected and selected the virtual server
                 *
                 * @event TeamSpeak3#ready
                 * @memberof TeamSpeak3
                 */
                .then(r => super.emit("ready"))
                .catch(e => super.emit("error", e))
        })


        /**
         * Query Close Event
         * Gets fired when the Query disconnects from the TeamSpeak Server
         *
         * @event TeamSpeak3#close
         * @memberof TeamSpeak3
         * @type {object}
         * @returns {object} - may return an error object
         */
        this._ts3.on("close", e => super.emit("close", e))
        /**
         * Query Error Event
         * Gets fired when the TeamSpeak Query had an error while trying to connect
         * and also gets fired when there was an error after receiving an event
         *
         * @event TeamSpeak3#error
         * @memberof  TeamSpeak3
         * @returns {object} - return the error object
         */
         this._ts3.on("error", e => super.emit("error", e))
    }


    /**
     * Client Join Event
     *
     * @event TeamSpeak3#clientconnect
     * @type {object}
     * @property {TeamSpeakClient} client - The Client which joined the Server
     */
    _evcliententerview() {
        var raw = arguments[0]
        this._clients[raw.clid] = new TeamSpeakClient(this, raw)
        super.emit("clientconnect", {
            client: this._clients[String(raw.clid)],
            cid: raw.ctid
        })
    }


    /**
     * Client Disconnect Event
     * Events Object contains all available Informations returned by the query
     *
     * @event TeamSpeak3#clientdisconnect
     * @type {object}
     * @property {object} client - The data from the last Client List Command
     * @property {object} event - The Data from the disconnect event
     */
    _evclientleftview() {
        var raw = arguments[0]
        super.emit("clientdisconnect", {
            client: (raw.clid in this._clients) ? this._clients[raw.clid].getCache() : {clid: raw.clid},
            event: raw
        })
        delete this._clients[String(raw.clid)]
    }


    /**
     * Textmessage event
     *
     * @event TeamSpeak3#textmessage
     * @memberof TeamSpeak3
     * @type {object}
     * @property {class} invoker - The Client which sent a textmessage
     * @property {string} msg - The Message which has been sent
     * @property {number} targetmode - The Targetmode (1 = Client, 2 = Channel, 3 = Virtual Server)
     */
    _evtextmessage() {
        var ev = arguments[0]
        this.getClientByID(ev.invokerid)
        .then(c => {
            super.emit("textmessage", {
                invoker: c,
                msg: ev.msg,
                targetmode: ev.targetmode
            })
        }).catch(e => super.emit("error", e))
    }


    /**
     * Client Move Event
     *
     * @event TeamSpeak3#clientmoved
     * @memberof TeamSpeak3
     * @type {object}
     * @property {class} client - The Client which moved
     * @property {class} channel - The Channel which the client has been moved to
     * @property {number} reasonid - Reason ID why the Client has moved (4 = Channel Kick)
     */
    _evclientmoved() {
        var args = arguments[0]
        Promise.all([
            this.getClientByID(args.clid),
            this.getChannelByID(args.ctid)
        ]).then(res => {
            this.emit("clientmoved", {
                client: res[0],
                channel: res[1],
                reasonid: args.reasonid
            })
        }).catch(e => this.emit("error", e))
    }


    /**
     * Server Edit Event
     *
     * @event TeamSpeak3#serveredit
     * @memberof TeamSpeak3
     * @type {object}
     * @property {class} invoker - The Client which edited the server
     * @property {object} modified - The Properties which has been modified
     */
    _evserveredited() {
        var args = arguments[0]
        this.getClientByID(args.invokerid)
        .then(client => {
            var prop = {invoker: client, modified: {}}
            Object.keys(args)
                .filter(k => k.indexOf("virtualserver_") === 0)
                .forEach(k => prop.modified[k] = args[k])
            this.emit("serveredit", prop)
        }).catch(e => this.emit("error", e))
    }


    /**
     * Channel Edit Event
     *
     * @event TeamSpeak3#channeledit
     * @memberof TeamSpeak3
     * @type {object}
     * @property {class} invoker - The Client which edited a channel
     * @property {class} channel - The Channel which has been edited
     * @property {object} modified - The Properties which has been modified
     */
    _evchanneledited() {
        var args = arguments[0]
        Promise.all([
            this.getClientByID(args.invokerid),
            this.getChannelByID(args.cid)
        ]).then(res => {
            var prop = {invoker: res[0], channel: res[1], modified: {}}
            Object.keys(args)
                .filter(k => k.indexOf("channel_") === 0)
                .forEach(k => prop.modified[k] = args[k])
            this.emit("channeledit", prop)
        }).catch(e => this.emit("error", e))
    }


    /**
     * Channel Create Event
     *
     * @event TeamSpeak3#channelcreate
     * @memberof TeamSpeak3
     * @type {object}
     * @property {class} invoker - The Client which created the channel
     * @property {class} channel - The Channel which has been created
     * @property {object} modified - The Properties which has been modified
     */
    _evchannelcreated() {
        var args = arguments[0]
        Promise.all([
            this.getClientByID(args.invokerid),
            this.getChannelByID(args.cid)
        ]).then(res => {
            var prop = {invoker: res[0], channel: res[1], modified: {}}
            Object.keys(args)
                .filter(k => k.indexOf("channel_") === 0)
                .forEach(k => prop.modified[k] = args[k])
            this.emit("channelcreate", prop)
        }).catch(e => this.emit("error", e))
    }


    /**
     * Channel Move Event
     *
     * @event TeamSpeak3#channelmoved
     * @memberof TeamSpeak3
     * @type {object}
     * @property {class} invoker - The Client which moved the channel
     * @property {class} channel - The Channel which has been moved
     * @property {class} parent - The new Parent Channel
     */
    _evchannelmoved() {
        var args = arguments[0]
        Promise.all([
            this.getClientByID(args.invokerid),
            this.getChannelByID(args.cid),
            this.getChannelByID(args.cpid)
        ]).then(res => this.emit("channelmoved", {
            invoker: res[0],
            channel: res[1],
            parent: res[2]
        })).catch(e => this.emit("error", e))
    }


    /**
     * Channel Delete Event
     *
     * @event TeamSpeak3#channeldelete
     * @memberof TeamSpeak3
     * @type {object}
     * @property {class} invoker - The Client which deleted the channel
     * @property {class} cid - The Channel ID which has been deleted
     */
    _evchanneldeleted() {
        this.getClientByID(arguments[0].invokerid)
        .then(client => {
            this.emit("channeldelete", {invoker: client, cid: arguments[0].cid})
        }).catch(e => this.emit("error", e))
    }


    /**
     * Sends a command to the TeamSpeak Server.
     * @version 1.0
     * @async
     * @param {string} Command - The Command which should get executed on the TeamSpeak Server
     * @param {object} [Object] - Optional the Parameters
     * @param {object} [Array] - Optional Flagwords
     * @returns {Promise<object>} Promise object which returns the Information about the Query executed
     */
    execute() {
        return this._ts3.execute(...arguments)
    }


    /**
     * Change your ServerQuery clients settings using given properties.
     * @version 1.0
     * @async
     * @param {string} properties - The Properties which should be changed
     * @returns {Promise.<object>}
     */
    clientUpdate(properties) {
        return this.execute("clientupdate", properties)
    }


    /**
     * Subscribes to an Event.
     * @version 1.0
     * @async
     * @param {string} event - The Event on which should be subscribed
     * @param {number} [id] - The Channel ID
     * @returns {Promise.<object>}
     */
    registerEvent(event, id = false) {
        var arg = {event: event}
        if (id !== false) arg.id = id
        return this.execute("servernotifyregister", arg)
    }


    /**
     * Authenticates with the TeamSpeak 3 Server instance using given ServerQuery login credentials.
     * @version 1.0
     * @async
     * @param {string} username - The Username which you want to login with
     * @param {string} password - The Password you want to login with
     * @returns {Promise.<object>}
     */
    login(username, password) {
        return this.execute("login", [username, password])
    }


    /**
     * Deselects the active virtual server and logs out from the server instance.
     * @version 1.0
     * @async
     * @returns {Promise.<object>}
     */
    logout() {
        return this._cacheCleanUp(this.execute("logout"))
    }


    /**
     * Displays the servers version information including platform and build number.
     * @version 1.0
     * @async
     * @returns {Promise.<object>}
     */
    version() {
        return this.execute("version")
    }


    /**
     * Displays detailed connection information about the server instance including uptime, number of virtual servers online, traffic information, etc.
     * @version 1.0
     * @async
     * @returns {Promise.<object>}
     */
    hostInfo() {
        return this.execute("hostinfo")
    }


    /**
     * Displays the server instance configuration including database revision number, the file transfer port, default group IDs, etc.
     * @version 1.0
     * @async
     * @returns {Promise.<object>}
     */
    instanceInfo() {
        return this.execute("instanceinfo")
    }


    /**
     * Changes the server instance configuration using given properties.
     * @version 1.0
     * @async
     * @param {object} properties - The stuff you want to change
     * @returns {Promise.<object>}
     */
    instanceEdit(properties) {
        return this.execute("instanceedit", properties)
    }


    /**
     * Displays a list of IP addresses used by the server instance on multi-homed machines.
     * @version 1.0
     * @async
     * @returns {Promise.<object>}
     */
    bindingList() {
        return this.execute("bindinglist")
    }


    /**
     * Selects the virtual server specified with the port to allow further interaction.
     * @version 1.0
     * @async
     * @param {number} port - The Port the Server runs on
     * @returns {Promise.<object>}
     */
    useByPort(port) {
        return this._cacheCleanUp(this.execute("use", {port: port}))
    }


    /**
     * Selects the virtual server specified with the sid to allow further interaction.
     * @version 1.0
     * @async
     * @param {number} sid - The Server ID
     * @returns {Promise.<object>}
     */
    useBySid(sid) {
        return this._cacheCleanUp(this.execute("use", [sid]))
    }


    /**
     * Displays information about your current ServerQuery connection including your loginname, etc.
     * @version 1.0
     * @async
     * @returns {Promise<object>} Promise object which provides the Information about the QueryClient
     */
    whoami() {
        return this.execute("whoami")
    }


    /**
     * Displays detailed configuration information about the selected virtual server including unique ID, number of clients online, configuration, etc.
     * @version 1.0
     * @async
     * @returns {Promise.<object>}
     */
    serverInfo() {
        return this.execute("serverinfo")
    }


    /**
     * Displays the database ID of the virtual server running on the UDP port
     * @version 1.0
     * @async
     * @param {number} port - The Server Port where data should be retrieved
     * @returns {Promise.<object>}
     */
    serverIdGetByPort(port) {
        return this.execute("serveridgetbyport", {virtualserver_port: port})
    }


    /**
     * Changes the selected virtual servers configuration using given properties. Note that this command accepts multiple properties which means that you're able to change all settings of the selected virtual server at once.
     * @version 1.0
     * @async
     * @param {object} properties - The Server Settings which should be changed
     * @returns {Promise.<object>}
     */
    serverEdit(properties) {
        return this.execute("serveredit", properties)
    }


    /**
     * Stops the entire TeamSpeak 3 Server instance by shutting down the process.
     * @version 1.0
     * @async
     * @param {string} [msg] - Specifies a text message that is sent to the clients before the client disconnects (requires TeamSpeak Server 3.2.0 or newer).
     * @returns {Promise.<object>}
     */
    serverProcessStop(msg) {
        return this.execute("serverprocessstop", {reasonmsg: msg})
    }


    /**
     * Displays detailed connection information about the selected virtual server including uptime, traffic information, etc.
     * @version 1.0
     * @async
     * @returns {Promise.<object>}
     */
    connectionInfo() {
        return this.execute("serverrequestconnectioninfo")
    }


    /**
     * Creates a new virtual server using the given properties and displays its ID, port and initial administrator privilege key. If virtualserver_port is not specified, the server will test for the first unused UDP port
     * @version 1.0
     * @async
     * @param {object} properties - The Server Settings
     * @returns {Promise.<object>} returns the server admin token for the new server and the response from the server creation
     */
    serverCreate(properties) {
        var token = ""
        return this.execute("servercreate", properties)
        .then(res => {
            //token = r.token
            return this.serverList({virtualserver_id: res.sid})
        }).then(server => {
            return new Promise(fulfill => fulfill({server: server[0], token: token}))
        })
    }


    /**
     * Deletes a Server.
     * @version 1.0
     * @async
     * @param {number} sid - the server id
     * @returns {Promise.<object>}
     */
    serverDelete(sid) {
        return this.execute("serverdelete", {sid: sid})
    }


    /**
     * Starts the virtual server. Depending on your permissions, you're able to start either your own virtual server only or all virtual servers in the server instance.
     * @version 1.0
     * @async
     * @param {number} sid - the server id
     * @returns {Promise.<object>}
     */
    serverStart(sid) {
        return this.execute("serverstart", {sid: sid})
    }


    /**
     * Stops the virtual server. Depending on your permissions, you're able to stop either your own virtual server only or all virtual servers in the server instance.
     * @version 1.0
     * @async
     * @param {number} sid - the server id
     * @param {string} [msg] - Specifies a text message that is sent to the clients before the client disconnects (requires TeamSpeak Server 3.2.0 or newer).
     * @returns {Promise.<object>}
     */
    serverStop(sid, msg) {
        return this.execute("serverstop", {sid: sid, reasonmsg: msg})
    }


    /**
     * Creates a new server group using the name specified with name. The optional type parameter can be used to create ServerQuery groups and template groups.
     * @version 1.0
     * @async
     * @param {string} name - The Name of the Server Group
     * @param {number} [type=1] - Type of the Server Group
     * @returns {Promise.<object>}
     */
    serverGroupCreate(name, type = 1) {
        return this.execute("servergroupadd", {name: name, type: type})
        .then(r => {
            return this.serverGroupList({sgid: r.sgid})
        }).then(g => {
            return new Promise(fulfill => fulfill(g[0]))
        })
    }


    /**
     * Displays the IDs of all clients currently residing in the server group.
     * @version 1.0
     * @async
     * @param {number} sgid - the ServerGroup id
     * @returns {Promise.<object>}
     */
    serverGroupClientList(sgid) {
        return this.execute("servergroupclientlist", {sgid: sgid}, ["-names"])
    }


    /**
     * Adds the client to the server group specified with sgid. Please note that a client cannot be added to default groups or template groups.
     * @version 1.0
     * @async
     * @param {string} cldbid - The Client Database ID which should be added
     * @param {number} sgid - The Server Group ID which the Client should be added to
     * @returns {Promise.<object>}
     */
    serverGroupAddClient(cldbid, sgid) {
        return this.execute("servergroupaddclient", {sgid: sgid, cldbid: cldbid})
    }


    /**
     * Removes the client from the server group specified with sgid.
     * @version 1.0
     * @async
     * @param {string} cldbid - The Client Database ID which should be removed
     * @param {number} sgid - The Server Group ID which the Client should be removed from
     * @returns {Promise.<object>}
     */
    serverGroupDelClient(cldbid, sgid) {
        return this.execute("servergroupdelclient", {sgid: sgid, cldbid: cldbid})
    }


    /**
     * Deletes the server group. If force is set to 1, the server group will be deleted even if there are clients within.
     * @version 1.0
     * @async
     * @param {number} sgid - the ServerGroup id
     * @param {number} force - If set to 1 the ServerGroup will be deleted even when Clients are in it
     * @returns {Promise.<object>}
     */
    serverGroupDel(sgid, force = 0) {
        return this.execute("servergroupdel", {sgid: sgid, force: force})
    }


    /**
     * Creates a copy of the server group specified with ssgid. If tsgid is set to 0, the server will create a new group. To overwrite an existing group, simply set tsgid to the ID of a designated target group. If a target group is set, the name parameter will be ignored.
     * @version 1.0
     * @async
     * @param {number} ssgid - the source ServerGroup
     * @param {number} [tsgid=0] - the target ServerGroup, 0 to create a new Group
     * @param {number} [type] - The Type of the Group (0 = Query Group | 1 = Normal Group)
     * @param {(string|boolean)} [name=false] - Name of the Group
     * @returns {Promise.<object>}
     */
    serverGroupCopy(ssgid, tsgid = 0, type = 1, name = false) {
        var prop = {ssgid: ssgid, tsgid: tsgid, type: type}
        if (typeof name === "string") prop.name = name
        return this.execute("servergroupcopy", prop)
    }


    /**
     * Changes the name of the server group
     * @version 1.0
     * @async
     * @param {number} sgid - the ServerGroup id
     * @param {string} name - new name of the ServerGroup
     * @returns {Promise.<object>}
     */
    serverGroupRename(sgid, name) {
        return this.execute("servergrouprename", {sgid: sgid, name: name})
    }


    /**
     * Displays a list of permissions assigned to the server group specified with sgid.
     * @version 1.0
     * @async
     * @param {number} sgid - the ServerGroup id
     * @param {boolean} [permsid=false] - If the permsid option is set to true the output will contain the permission names.
     * @returns {Promise.<object>}
     */
    serverGroupPermList(sgid, permsid = false) {
        return this.execute("servergrouppermlist", {sgid: sgid}, [permsid ? "-permsid" : null]).then(this.toArray)
    }


    /**
     * Adds a specified permissions to the server group. A permission can be specified by permid or permsid.
     * @version 1.0
     * @async
     * @param {number} sgid - the ServerGroup id
     * @param {(string|number)} perm - The permid or permsid
     * @param {number} value - Value of the Permission
     * @param {boolean} [permsid=false] - Whether a permsid or permid should be used
     * @param {number} [skip=0] - Whether the skip flag should be set
     * @param {number} [negate=0] - Whether the negate flag should be set
     * @returns {Promise.<object>}
     */
    serverGroupAddPerm(sgid, perm, value, permsid = false, skip = 0, negate = 0) {
        var prop = {sgid: sgid}
        prop[(permsid) ? "permsid": "permid"] = perm
        prop.permvalue = value
        prop.permskip = skip
        prop.permnegated = negate
        return this.execute("servergroupaddperm", prop)
    }


    /**
     * Removes a set of specified permissions from the server group. A permission can be specified by permid or permsid.
     * @version 1.0
     * @async
     * @param {number} sgid - the ServerGroup id
     * @param {(string|number)} perm - The permid or permsid
     * @param {boolean} [permsid=false] - Whether a permsid or permid should be used
     * @returns {Promise.<object>}
     */
    serverGroupDelPerm(sgid, perm, permsid = false) {
        var prop = {sgid: sgid}
        prop[(permsid) ? "permsid" : "permid"] = perm
        return this.execute("servergroupdelperm", prop)
    }


    /**
     * Creates a new channel using the given properties. Note that this command accepts multiple properties which means that you're able to specifiy all settings of the new channel at once.
     * @version 1.0
     * @async
     * @param {string} name - The Name of the Channel
     * @param {object} [type={}] - Properties of the Channel
     * @returns {Promise.<object>}
     */
    channelCreate(name, properties = {}) {
        properties.channel_name = name
        return this.execute("channelcreate", properties)
        .then(r => {
            return this.channelList({cid: r.cid})
        }).then(c => {
            return new Promise(fulfill => fulfill(c[0]))
        })
    }


    /**
     * Creates a new channel group using a given name. The optional type parameter can be used to create ServerQuery groups and template groups.
     * @version 1.0
     * @async
     * @param {string} name - The Name of the Channel Group
     * @param {number} [type=1] - Type of the Channel Group
     * @returns {Promise.<object>}
     */
    channelGroupCreate(name, type = 1) {
        return this.execute("channelgroupadd", {name: name, type: type})
        .then(r => {
            return this.channelGroupList({cgid: r.cgid})
        }).then(g => {
            return new Promise(fulfill => fulfill(g[0]))
        })
    }


    /**
     * Retrieves a Single Channel by the given Channel ID
     * @version 1.0
     * @async
     * @param {number} cid - The Channel Id
     * @returns {Promise<TeamSpeakChannel>} Promise object which returns the Channel Object or undefined if not found
     */
    getChannelByID(cid) {
        return new Promise((fulfill, reject) => {
            this.channelList({cid: cid})
                .then(channel => fulfill(channel[0]))
                .catch(reject)
        })
    }


    /**
     * Retrieves a Single Channel by the given Channel Name
     * @version 1.0
     * @async
     * @param {number} name - The Name of the Channel
     * @returns {Promise<TeamSpeakChannel>} Promise object which returns the Channel Object or undefined if not found
     */
    getChannelByName(name) {
        return new Promise((fulfill, reject) => {
            this.channelList({channel_name: name})
                .then(channel => fulfill(channel[0]))
                .catch(reject)
        })
    }


    /**
     * Displays detailed configuration information about a channel including ID, topic, description, etc.
     * @version 1.0
     * @async
     * @param {number} cid - the channel id
     * @return {Promise.<object>}
     */
    channelInfo(cid) {
        return this.execute("channelinfo", {cid: cid})
    }


    /**
     * Moves a channel to a new parent channel with the ID cpid. If order is specified, the channel will be sorted right under the channel with the specified ID. If order is set to 0, the channel will be sorted right below the new parent.
     * @version 1.0
     * @async
     * @param {number} cid - the channel id
     * @param {number} cpid - Channel Parent ID
     * @param {number} [order=0] - Channel Sort Order
     * @return {Promise.<object>}
     */
    channelMove(cid, cpid, order = 0) {
        return this.execute("channelmove", {cid: cid, cpid: cpid, order: order})
    }


    /**
     * Deletes an existing channel by ID. If force is set to 1, the channel will be deleted even if there are clients within. The clients will be kicked to the default channel with an appropriate reason message.
     * @version 1.0
     * @async
     * @param {number} cid - the channel id
     * @param {number} force - If set to 1 the Channel will be deleted even when Clients are in it
     * @return {Promise.<object>}
     */
    channelDelete(cid, force = 0) {
        return this.execute("channeldelete", {cid: cid, force: force})
    }


    /**
     * Changes a channels configuration using given properties. Note that this command accepts multiple properties which means that you're able to change all settings of the channel specified with cid at once.
     * @version 1.0
     * @async
     * @param {number} cid - the channel id
     * @param {number} properties - The Properties of the Channel which should get changed
     * @return {Promise.<object>}
     */
    channelEdit(cid, properties) {
        properties.cid = cid
        return this.execute("channeledit", properties)
    }


    /**
     * Displays a list of permissions defined for a channel.
     * @version 1.0
     * @async
     * @param {number} cid - the channel id
     * @param {boolean} permsid - Whether the Perm SID should be displayed aswell
     * @return {Promise.<object[]>}
     */
    channelPermList(cid, permsid = false) {
        return this.execute("channelpermlist", {cid: cid}, (permsid) ? ["-permsid"] : null).then(this.toArray)
    }


    /**
     * Adds a set of specified permissions to a channel. Multiple permissions can be added by providing the two parameters of each permission. A permission can be specified by permid or permsid.
     * @version 1.0
     * @async
     * @param {number} cid - the channel id
     * @param {(string|number)} perm - The permid or permsid
     * @param {number} value - The Value which should be set
     * @param {boolean} sid - If the given Perm is a permsid
     * @return {Promise.<object>}
     */
    channelSetPerm(cid, perm, value, sid = false) {
        var prop = {cid: cid}
        prop[(sid) ? "permsid" : "permid"] = perm
        prop.permvalue = value
        return this.execute("channeladdperm", prop)
    }


    /**
     * Removes a set of specified permissions from a channel. Multiple permissions can be removed at once. A permission can be specified by permid or permsid.
     * @version 1.0
     * @async
     * @param {number} cid - the channel id
     * @param {(string|number)} perm - The permid or permsid
     * @param {boolean} sid - If the given Perm is a permsid
     * @return {Promise.<object>}
     */
    channelDelPerm(cid, perm, sid = false) {
        var prop = {cid: cid}
        prop[(sid) ? "permsid" : "permid"] = perm
        return this.execute("channeldelperm", prop)
    }


    /**
     * Retrieves a Single Client by the given Client ID
     * @version 1.0
     * @async
     * @param {number} clid - The Client Id
     * @returns {Promise.<TeamSpeakClient>} Promise object which returns the Client or undefined if not found
     */
    getClientByID(clid) {
        return new Promise((fulfill, reject) => {
            this.clientList({clid: clid})
                .then(clients => fulfill(clients[0]))
                .catch(reject)
        })
    }


    /**
     * Retrieves a Single Client by the given Client Database ID
     * @version 1.0
     * @async
     * @param {number} cldbid - The Client Database Id
     * @returns {Promise.<TeamSpeakClient>} Promise object which returns the Client or undefined if not found
     */
    getClientByDBID(cldbid) {
        return new Promise((fulfill, reject) => {
            this.clientList({client_database_id: cldbid})
                .then(clients => fulfill(clients[0]))
                .catch(reject)
        })
    }


    /**
     * Retrieves a Single Client by the given Client Unique Identifier
     * @version 1.0
     * @async
     * @param {string} uid - The Client Unique Identifier
     * @returns {Promise.<TeamSpeakClient>} Promise object which returns the Client or undefined if not found
     */
    getClientByUID(uid) {
        return new Promise((fulfill, reject) => {
            this.clientList({client_unique_identifier: uid})
                .then(clients => fulfill(clients[0]))
                .catch(reject)
        })
    }


    /**
     * Retrieves a Single Client by the given Client Unique Identifier
     * @version 1.0
     * @async
     * @param {string} name - The Nickname of the Client
     * @returns {Promise.<TeamSpeakClient>} Promise object which returns the Client or undefined if not found
     */
    getClientByName(name) {
        return new Promise((fulfill, reject) => {
            this.clientList({client_nickname: name})
                .then(clients => fulfill(clients[0]))
                .catch(reject)
        })
    }


    /**
     * Returns General Info of the Client, requires the Client to be online
     * @version 1.0
     * @async
     * @param {number} clid - the client id
     * @returns {Promise.<object>} Promise with the Client Information
     */
    clientInfo(clid) {
        return this.execute("clientinfo", {clid: clid})
    }


    /**
     * Returns the Clients Database List
     * @version 1.0.1
     * @async
     * @param {number} [start=0] - Start Offset
     * @param {number} [duration=1000] - Duration or Limit of Clients
     * @param {boolean} count - True when the results should be counted
     * @returns {Promise.<object>} Returns the Client Database Info
     */
    clientDBList(start = 0, duration = 1000, count = true) {
        return this.execute("clientdblist", {start: start, duration: duration}, [(count) ? "-count" : null])
    }


    /**
     * Returns the Clients Database Info
     * @version 1.0
     * @async
     * @param {number} dbid - the client database id
     * @returns {Promise.<object>} Returns the Client Database Info
     */
    clientDBInfo(dbid) {
        return this.execute("clientdbinfo", {cldbid: dbid})
    }


    /**
     * Kicks the Client from the Server
     * @version 1.0
     * @async
     * @param {number} clid - the client id
     * @param {number} reasonid - the reasonid
     * @param {string} msg - The Message the Client should receive when getting kicked
     * @returns {Promise.<object>} Promise Object
     */
    clientKick(clid, reasonid, msg) {
        return this.execute("clientkick", {clid: clid, reasonid: reasonid, reasonmsg: msg})
    }


    /**
     * Moves the Client to a different Channel
     * @version 1.0
     * @async
     * @param {number} clid - the client id
     * @param {number} cid - Channel ID in which the Client should get moved
     * @param {string} [cpw=""] - The Channel Password
     * @returns {Promise.<object>} Promise Object
     */
    clientMove(clid, cid, cpw = "") {
        return this.execute("clientmove", {clid: clid, cid: cid, cpw:cpw})
    }


    /**
     * Pokes the Client with a certain message
     * @version 1.0
     * @async
     * @param {number} clid - the client id
     * @param {string} msg - The message the Client should receive
     * @returns {Promise.<object>} Promise Object
     */
    clientPoke(clid, msg) {
        return this.execute("clientpoke", {clid: clid, msg: msg})
    }


    /**
     * Displays a list of permissions defined for a client
     * @version 1.0
     * @async
     * @param {number} dbid - the client database id
     * @param {boolean} [permsid=false] - If the permsid option is set to true the output will contain the permission names.
     * @return {Promise.<object>}
     */
    clientPermList(dbid, permsid = false) {
        return this.execute("clientpermlist", {cldbid: dbid}, [(permsid) ? "-permsid" : null]).then(this.toArray)
    }


    /**
     * Adds a set of specified permissions to a client. Multiple permissions can be added by providing the three parameters of each permission. A permission can be specified by permid or permsid.
     * @version 1.0
     * @async
     * @param {number} dbid - the client database id
     * @param {(string|number)} perm - The permid or permsid
     * @param {number} value - Value of the Permission
     * @param {boolean} [permsid=false] - Whether a permsid or permid should be used
     * @param {number} [skip=0] - Whether the skip flag should be set
     * @param {number} [negate=0] - Whether the negate flag should be set
     * @return {Promise.<object>}
     */
    clientAddPerm(dbid, perm, value, permsid = false, skip = 0, negate = 0) {
        var prop = {cldbid: dbid}
        prop[(permsid) ? "permsid": "permid"] = perm
        prop.permvalue = value
        prop.permskip = skip
        prop.permnegated = negate
        return this.execute("clientaddperm", prop)
    }


    /**
     * Removes a set of specified permissions from a client. Multiple permissions can be removed at once. A permission can be specified by permid or permsid
     * @version 1.0
     * @async
     * @param {number} dbid - the client database id
     * @param {(string|number)} perm - The permid or permsid
     * @param {boolean} [permsid=false] - Whether a permsid or permid should be used
     * @return {Promise.<object>}
     */
    clientDelPerm(dbid, perm, permsid = false) {
        var prop = {cldbid: dbid}
        prop[(permsid) ? "permsid" : "permid"] = perm
        return this.execute("clientdelperm", prop)
    }


    /**
     * Searches for custom client properties specified by ident and value.
     * The value parameter can include regular characters and SQL wildcard characters (e.g. %).
     * @version 1.3
     * @async
     * @param {string} ident - the key to search for
     * @param {string} target - the search pattern to use
     * @returns {Promise.<object>} Promise Object
     */
    customSearch(ident, pattern) {
        return this.execute("customsearch", {ident: ident, pattern: pattern})
    }


    /**
     * Displays a list of custom properties for the client specified with cldbid.
     * @version 1.3
     * @async
     * @param {number} cldbid - The Client Database ID which should be retrieved
     * @returns {Promise.<object>} Promise Object
     */
    customInfo(cldbid) {
        return this.execute("custominfo", {cldbid: cldbid})
    }


    /**
     * Removes a custom property from a client specified by the cldbid.
     * This requires TeamSpeak Server Version 3.2.0 or newer.
     * @version 1.3
     * @async
     * @param {number} cldbid - The Client Database ID which should be changed
     * @param {string} ident - The Key which should be deleted
     * @returns {Promise.<object>} Promise Object
     */
    customDelete(cldbid, ident) {
        return this.execute("customdelete", {cldbid: cldbid, ident: ident})
    }


    /**
     * Creates or updates a custom property for client specified by the cldbid.
     * Ident and value can be any value, and are the key value pair of the custom property.
     * This requires TeamSpeak Server Version 3.2.0 or newer.
     * @version 1.3
     * @async
     * @param {number} cldbid - The Client Database ID which should be changed
     * @param {string} ident - The Key which should be set
     * @param {string} value - The Value which should be set
     * @returns {Promise.<object>} Promise Object
     */
    customSet(cldbid, ident, value) {
        return this.execute("customset", {cldbid: cldbid, ident: ident, value: value})
    }


    /**
     * Sends a text message a specified target.
     * The type of the target is determined by targetmode while target specifies the ID of the recipient, whether it be a virtual server, a channel or a client.
     * @version 1.0
     * @async
     * @param {string} target - target to message
     * @param {string} targetmode - targetmode (1: client, 2: channel, 3: server)
     * @param {string} msg - The message the Client should receive
     * @returns {Promise.<object>} Promise Object
     */
    sendTextMessage(target, targetmode, msg) {
        return this.execute("sendtextmessage", {targetmode: targetmode, target: target, msg: msg})
    }


    /**
     * Retrieves a single ServerGroup by the given ServerGroup ID
     * @version 1.0
     * @async
     * @param {number} sgid - the ServerGroup Id
     * @returns {Promise.<TeamSpeakServerGroup>} Promise object which returns the ServerGroup or undefined if not found
     */
    getServerGroupByID(sgid) {
        return new Promise((fulfill, reject) => {
            this.serverGroupList({sgid: sgid})
                .then(groups => fulfill(groups[0]))
                .catch(reject)
        })
    }


    /**
     * Retrieves a single ServerGroup by the given ServerGroup Name
     * @version 1.0
     * @async
     * @param {number} name - the ServerGroup name
     * @returns {Promise.<TeamSpeakServerGroup>} Promise object which returns the ServerGroup or undefined if not found
     */
    getServerGroupByName(name) {
        return new Promise((fulfill, reject) => {
            this.serverGroupList({name: name})
                .then(groups => fulfill(groups[0]))
                .catch(reject)
        })
    }


    /**
     * Retrieves a single ChannelGroup by the given ChannelGroup ID
     * @version 1.0
     * @async
     * @param {number} cgid - the ChannelGroup Id
     * @returns {Promise.<TeamSpeakServerGroup>} Promise object which returns the ChannelGroup or undefined if not found
     */
    getChannelGroupByID(cgid) {
        return new Promise((fulfill, reject) => {
            this.channelGroupList({cgid: cgid})
                .then(groups => fulfill(groups[0]))
                .catch(reject)
        })
    }


    /**
     * Retrieves a single ChannelGroup by the given ChannelGroup Name
     * @version 1.0
     * @async
     * @param {number} name - the ChannelGroup name
     * @returns {Promise.<TeamSpeakServerGroup>} Promise object which returns the ChannelGroup or undefined if not found
     */
    getChannelGroupByName(name) {
        return new Promise((fulfill, reject) => {
            this.channelGroupList({name: name})
                .then(groups => fulfill(groups[0]))
                .catch(reject)
        })
    }


    /**
     * Sets the channel group of a client
     * @version 1.0
     * @async
     * @param {number} cgid - The Channel Group which the Client should get assigned
     * @param {number} cid - The Channel in which the Client should be assigned the Group
     * @param {number} cldbid - The Client Database ID which should be added to the Group
     * @return {Promise.<object>}
     */
    setClientChannelGroup(cgid, cid, cldbid) {
        return this.execute("setclientchannelgroup", {cgid: cgid, cldbid: cldbid, cid: cid})
    }


    /**
     * Deletes the channel group. If force is set to 1, the channel group will be deleted even if there are clients within.
     * @version 1.0
     * @async
     * @param {cgid} cgid - the channelgroup id
     * @param {number} [force=0] - If set to 1 the Channel Group will be deleted even when Clients are in it
     * @return {Promise.<object>}
     */
    deleteChannelGroup(cgid, force = 0) {
        return this.execute("channelgroupdel", {cgid: cgid, force: force})
    }


    /**
     * Creates a copy of the channel group. If tcgid is set to 0, the server will create a new group. To overwrite an existing group, simply set tcgid to the ID of a designated target group. If a target group is set, the name parameter will be ignored.
     * @version 1.0
     * @async
     * @param {number} scgid - the source ChannelGroup
     * @param {number} [tcgid=0] - the target ChannelGroup (0 to create a new Group)
     * @param {number} [type] - The Type of the Group (0 = Template Group | 1 = Normal Group)
     * @param {(string|boolean)} [name=false] - Name of the Group
     * @return {Promise.<object>}
     */
    channelGroupCopy(scgid, tcgid = 0, type = 1, name = false) {
        var prop = {scgid: scgid, tcgid: tcgid, type: type}
        if (typeof name === "string") prop.name = name
        return this.execute("channelgroupcopy", prop)
    }


    /**
     * Changes the name of the channel group
     * @version 1.0
     * @async
     * @param {number} cgid - the ChannelGroup id to rename
     * @param {string} name - new name of the ChannelGroup
     * @return {Promise.<object>}
     */
    channelGroupRename(cgid, name) {
        return this.execute("channelgrouprename", {cgid: cgid, name: name})
    }


    /**
     * Displays a list of permissions assigned to the channel group specified with cgid.
     * @version 1.0
     * @async
     * @param {number} cgid - the ChannelGroup id to list
     * @param {boolean} [permsid=false] - If the permsid option is set to true the output will contain the permission names.
     * @return {Promise.<object[]>}
     */
    channelGroupPermList(cgid, permsid = false) {
        return this.execute("channelgrouppermlist", {cgid: cgid}, [(permsid) ? "-permsid" : null]).then(this.toArray)
    }


    /**
     * Adds a specified permissions to the channel group. A permission can be specified by permid or permsid.
     * @version 1.0
     * @async
     * @param {number} cgid - the ChannelGroup id
     * @param {(string|number)} perm - The permid or permsid
     * @param {number} value - Value of the Permission
     * @param {boolean} [permsid=false] - Whether a permsid or permid should be used
     * @param {number} [skip=0] - Whether the skip flag should be set
     * @param {number} [negate=0] - Whether the negate flag should be set
     * @return {Promise.<object>}
     */
    channelGroupAddPerm(cgid, perm, value, permsid = false, skip = 0, negate = 0) {
        var prop = {cgid: cgid}
        prop[(permsid) ? "permsid": "permid"] = perm
        prop.permvalue = value
        prop.permskip = skip
        prop.permnegated = negate
        return this.execute("channelgroupaddperm", prop)
    }


    /**
     * Removes a set of specified permissions from the channel group. A permission can be specified by permid or permsid.
     * @version 1.0
     * @async
     * @param {number} cgid - the ChannelGroup id
     * @param {(string|number)} perm - The permid or permsid
     * @param {boolean} [permsid=false] - Whether a permsid or permid should be used
     * @return {Promise.<object>}
     */
    channelGroupDelPerm(cgid, perm, permsid = false) {
        var prop = {cgid: cgid}
        prop[(permsid) ? "permsid" : "permid"] = perm
        return this.execute("channelgroupdelperm", prop)
    }


    /**
     * Displays the IDs of all clients currently residing in the channel group.
     * @version 1.0
     * @async
     * @param {number} cgid - the ChannelGroup id
     * @param {number} [cid] - The Channel ID
     * @return {Promise.<TeamSpeakClient>}
     */
    channelGroupClientList(cgid, cid) {
        var prop = {cgid: cgid}
        if (typeof cid == "number") prop.cid = cid
        return this.execute("channelgroupclientlist", prop)
    }


    /**
     * Displays all permissions assigned to a client for the channel specified with cid. If permid is set to 0, all permissions will be displayed. A permission can be specified by permid or permsid.
     * @async
     * @param {number} cldbid - The Client Database ID
     * @param {number} cid - One or more Permission Names
     * @param {number} [permid] - One or more Permission IDs
     * @param {number} [permsid] - One or more Permission Names
     * @returns {Promise.<object>} retrieves assigned permissions
     */
    permOverview(cldbid, cid, permid, permsid) {
        var props = { cldbid: cldbid, cid: cid }
        if (permid !== null && permid !== undefined) props.permid = permid
        if (permsid !== null && permsid !== undefined) props.permsid = permsid
        return this.execute("permoverview", props)
    }


    /**
     * Retrieves a list of permissions available on the server instance including ID, name and description.
     * @version 1.0
     * @async
     * @returns {Promise.<object[]>} gets a list of permissions available
     */
    permissionList() {
        return this.execute("permissionlist")
    }


    /**
     * Retrieves the database ID of one or more permissions specified by permsid.
     * @version 1.0
     * @async
     * @param {(string|array)} permsid - One or more Permission Names
     * @returns {Promise.<object>} gets the specified permissions
     */
    permIdGetByName(permsid) {
        return this.execute("permidgetbyname", {permsid: permsid})
    }


    /**
     * Retrieves the current value of the permission for your own connection. This can be useful when you need to check your own privileges.
     * @version 1.0
     * @async
     * @param {number|string} key - Perm ID or Name which should be checked
     * @returns {Promise.<object>} gets the permissions
     */
    permGet(key) {
        var prop = {}
        if (typeof key === "string")
            prop.permsid = key
        else
            prop.permid = key
        return this.execute("permget", prop)
    }


    /**
     * Retrieves detailed information about all assignments of the permission. The output is similar to permoverview which includes the type and the ID of the client, channel or group associated with the permission.
     * @version 1.0
     * @async
     * @param {(number|string)} perm - Perm ID or Name to get
     * @returns {Promise.<object>} gets the permissions
     */
    permFind(perm) {
        var prop = {}
        if (typeof perm === "number")
            prop.permid = perm
        else
            prop.permsid = perm
        return this.execute("permfind", prop)
    }


    /**
     * Restores the default permission settings on the selected virtual server and creates a new initial administrator token. Please note that in case of an error during the permreset call - e.g. when the database has been modified or corrupted - the virtual server will be deleted from the database.
     * @version 1.0
     * @async
     * @returns {Promise}
     */
    permReset() {
        return this.execute("permreset")
    }


    /**
     * Retrieves a list of privilege keys available including their type and group IDs.
     * @version 1.0
     * @async
     * @returns {Promise.<object>} gets a list of privilegekeys
     */
    privilegekeyList() {
        return this.execute("privilegekeylist")
    }


    /**
     * Create a new token. If type is set to 0, the ID specified with tokenid will be a server group ID. Otherwise, tokenid is used as a channel group ID and you need to provide a valid channel ID using channelid.
     * @version 1.0
     * @async
     * @param {number} type - Token Type
     * @param {number} group - Depends on the Type given, add either a valid Channel Group or Server Group
     * @param {number} [cid] - Depends on the Type given, add a valid Channel ID
     * @param {string} [description] - Token Description
     * @returns {Promise.<object>}
     */
    privilegekeyAdd(type, group, cid, description) {
        var prop = {tokentype: type, tokenid1: group, tokenid2: 0}
        if (type === 1) prop.tokenid2 = cid
        if (description) prop.description = description
        return this.execute("privilegekeyadd", prop)
    }


    /**
     * Deletes an existing token matching the token key specified with token.
     * @version 1.0
     * @async
     * @param {string} token - The token which should be deleted
     * @returns {Promise.<object>}
     */
    privilegekeyDelete(token) {
        return this.execute("privilegekeydelete", {token: token})
    }


    /**
     * Use a token key gain access to a server or channel group. Please note that the server will automatically delete the token after it has been used.
     * @version 1.0
     * @async
     * @param {string} token - The token which should be used
     * @returns {Promise.<object>}
     */
    privilegekeyUse(token) {
        return this.execute("privilegekeyuse", {token: token})
    }


    /**
     * Displays a list of offline messages you've received. The output contains the senders unique identifier, the messages subject, etc.
     * @version 1.0
     * @async
     * @returns {Promise.<object>}
     */
    messageList() {
        return this.execute("messagelist")
    }


    /**
     * Sends an offline message to the client specified by uid.
     * @version 1.0
     * @async
     * @param {string} uid - Client Unique Identifier (uid)
     * @param {string} subject - Subject of the message
     * @param {string} text - Message Text
     * @returns {Promise.<object>}
     */
    messageAdd(uid, subject, text) {
        return this.execute("messageadd", {cluid: uid, subject: subject, text: text})
    }


    /**
     * Sends an offline message to the client specified by uid.
     * @version 1.0
     * @async
     * @param {number} id - The Message ID which should be deleted
     * @returns {Promise.<object>}
     */
    messageDel(id) {
        return this.execute("messagedel", {msgid: id})
    }


    /**
     * Displays an existing offline message with the given id from the inbox.
     * @version 1.0
     * @async
     * @param {number} id - Gets the content of the Message
     * @returns {Promise.<object>}
     */
    messageGet(id) {
        return this.execute("messageget", {msgid: id})
    }


    /**
     * Displays an existing offline message with the given id from the inbox.
     * @version 1.0
     * @async
     * @param {number} id - Gets the content of the Message
     * @param {number} read - If flag is set to 1 the message will be marked as read
     * @returns {Promise.<object>}
     */
    messageUpdate(id, read) {
        return this.execute("messageupdateflag", {msgid: id, flag: flag})
    }


    /**
     * Displays a list of complaints on the selected virtual server. If dbid is specified, only complaints about the targeted client will be shown.
     * @version 1.0
     * @async
     * @param {number} [dbid] - Filter only for certain Client with the given Database ID
     * @returns {Promise.<object>}
     */
    complainList(dbid) {
        return this.execute("complainlist", (typeof dbid === "number") ? {cldbid: dbid} : null)
    }


    /**
     * Submits a complaint about the client with database ID dbid to the server.
     * @version 1.0
     * @async
     * @param {number} dbid - Filter only for certain Client with the given Database ID
     * @param {string} [message] - The Message which should be added
     * @returns {Promise.<object>}
     */
    complainAdd(dbid, message = "") {
        return this.execute("complainadd", {cldbid: dbid, message: message})
    }


    /**
     * Deletes the complaint about the client with ID tdbid submitted by the client with ID fdbid from the server. If dbid will be left empty all complaints for the tdbid will be deleted
     * @version 1.0
     * @async
     * @param {number} tcldbid - The Target Client Database ID
     * @param {number} fcldbid - The Client Database ID which filed the Report
     * @returns {Promise.<object>}
     */
    complainDel(tdbid, fdbid = false) {
        var cmd = (fdbid === false) ? "complaindelall" : "complaindel"
        var prop = {tcldbid: tdbid}
        if (fdbid === false) prop.fcldbid = fdbid
        return this.execute(cmd, prop)
    }


    /**
     * Displays a list of active bans on the selected virtual server.
     * @version 1.0
     * @async
     * @returns {Promise.<object>}
     */
    banList() {
        return this.execute("banlist")
    }


    /**
     * Adds a new ban rule on the selected virtual server. All parameters are optional but at least one of the following must be set: ip, name, or uid.
     * @version 1.0
     * @async
     * @param {string} [ip] - IP Regex
     * @param {string} [name] - Name Regex
     * @param {string} [uid] - UID Regex
     * @param {number} time - Bantime in Seconds, if left empty it will result in a permaban
     * @param {string} reason - Ban Reason
     * @returns {Promise.<object>}
     */
    banAdd(ip, name, uid, time, reason) {
        var props = {}
        if (ip) props.ip = ip
        if (name) props.name = name
        if (uid) props.uid = uid
        if (time) props.time = time
        props.banreason = reason || ""
        return this.execute("banadd", props)
    }


    /**
     * Removes one or all bans from the server
     * @version 1.0
     * @async
     * @param {number} [id] - The BanID to remove, if not provided it will remove all bans
     * @returns {Promise.<object>}
     */
    banDel(id = false) {
        return this.execute(
            (id === false) ? "bandelall" : "bandel",
            (id !== false) ? {banid: id} : null
        )
    }


    /**
     * Displays a specified number of entries from the servers log. If instance is set to 1, the server will return lines from the master logfile (ts3server_0.log) instead of the selected virtual server logfile.
     * @version 1.0
     * @async
     * @param {number} [lines=1000] - Lines to receive
     * @param {number} [reverse=0] - Invert Output
     * @param {number} [instance=0] - Instance or Virtual Server Log
     * @param {number} [begin_pos=0] - Begin at Position
     * @returns {Promise.<object>}
     */
    logView(lines = 1000, reverse = 0, instance = 0, begin_pos = 0) {
        return this.execute("logview", { lines: lines, reverse: reverse, instance: instance, begin_pos: begin_pos })
    }


    /**
     * Writes a custom entry into the servers log. Depending on your permissions, you'll be able to add entries into the server instance log and/or your virtual servers log. The loglevel parameter specifies the type of the entry
     * @version 1.0
     * @async
     * @param {number} level - Level 1 to 4
     * @param {string} msg - Message to log
     * @returns {Promise.<object>}
     */
    logAdd(level, msg) {
        return this.execute("logadd", { loglevel: level, logmsg: msg })
    }


    /**
     * Sends a text message to all clients on all virtual servers in the TeamSpeak 3 Server instance.
     * @version 1.0
     * @async
     * @param {string} msg - Message which will be sent to all instances
     * @returns {Promise.<object>}
     */
    gm(msg) {
        return this.execute("gm", { msg: msg })
    }


    /**
     * Displays detailed database information about a client including unique ID, creation date, etc.
     * @version 1.0
     * @async
     * @param {number} cldbid - The Client Database ID which should be searched for
     * @returns {Promise.<object>}
     */
    clientDBInfo(cldbid) {
        return this.execute("clientdbinfo", {cldbid: cldbid})
    }


    /**
     * Displays a list of client database IDs matching a given pattern. You can either search for a clients last known nickname or his unique identity by using the -uid option.
     * @version 1.0
     * @async
     * @param {string} pattern - The Pattern which should be searched for
     * @param {boolean} isUid - True when instead of the Name it should be searched for a uid
     * @returns {Promise.<object>}
     */
    clientDBFind(pattern, isUid = false) {
        return this.execute("clientdbfind", {pattern: pattern}, (isUid) ? ["-uid"] : [])
    }


    /**
     * Changes a clients settings using given properties.
     * @version 1.0
     * @async
     * @param {string} cldbid - The Client Database ID which should be edited
     * @param {object} properties - The Properties which should be modified
     * @returns {Promise.<object>}
     */
    clientDBEdit(cldbid, properties) {
        properties.cldbid = cldbid
        return this.execute("clientdbedit", properties)
    }


    /**
     * Deletes a clients properties from the database.
     * @version 1.0
     * @async
     * @param {string} cldbid - The Client Database ID which should be edited
     * @param {object} properties - The Properties which should be modified
     * @returns {Promise.<object>}
     */
    clientDBDelete(cldbid) {
        return this.execute("clientdbdelete", {cldbid: cldbid})
    }


    /**
     * Displays a list of virtual servers including their ID, status, number of clients online, etc.
     * @version 1.0
     * @async
     * @returns {Promise.<TeamSpeakServer[]>}
     */
    serverList(filter = {}) {
        return this.execute(
            "serverlist", ["-uid", "-all"]
        ).then(servers => {
            return this._handleCache(this._servers, servers, "virtualserver_id", TeamSpeakServer)
        }).then(servers => {
            return this.constructor._filter(servers, filter)
        }).then(servers => {
            return new Promise((fulfill, reject) => {
                fulfill(servers.map(s => {
                    return this._servers[s.virtualserver_id]
                }))
            })
        })
    }


    /**
     * Displays a list of channel groups available. Depending on your permissions, the output may also contain template groups.
     * @version 1.0
     * @async
     * @param {object} filter - Filter Object
     * @returns {Promise.<TeamSpeakChannelGroup[]>} Promise object which returns an Array of TeamSpeak Server Groups
     */
    channelGroupList(filter = {}) {
        return this.execute(
            "channelgrouplist"
        ).then(groups => {
            return this._handleCache(this._channelgroups, groups, "cgid", TeamSpeakChannelGroup)
        }).then(groups => {
            return this.constructor._filter(groups, filter)
        }).then(groups => {
            return new Promise((fulfill, reject) => {
                fulfill(groups.map(g => {
                    return this._channelgroups[g.cgid]
                }))
            })
        })
    }


    /**
     * Displays a list of server groups available. Depending on your permissions, the output may also contain global ServerQuery groups and template groups.
     * @version 1.0
     * @async
     * @param {object} filter - Filter Object
     * @returns {Promise.<TeamSpeakServerGroup[]>} Promise object which returns an Array of TeamSpeak Server Groups
     */
    serverGroupList(filter = {}) {
        return this.execute(
            "servergrouplist"
        ).then(groups => {
            return this._handleCache(this._servergroups, groups, "sgid", TeamSpeakServerGroup)
        }).then(groups => {
            return this.constructor._filter(groups, filter)
        }).then(groups => {
            return new Promise((fulfill, reject) => {
                fulfill(groups.map(g => {
                    return this._servergroups[g.sgid]
                }))
            })
        })
    }


    /**
     * Lists all Channels with a given Filter
     * @version 1.0
     * @async
     * @param {object} filter - Filter Object
     * @returns {Promise<TeamSpeakChannel[]>} Promise object which returns an Array of TeamSpeak Channels
     */
    channelList(filter = {}) {
        return this.execute(
            "channellist", ["-topic", "-flags", "-voice", "-limits", "-icon", "-secondsempty"]
        ).then(channels => {
            return this._handleCache(this._channels, channels, "cid", TeamSpeakChannel)
        }).then(channels => {
            return this.constructor._filter(channels, filter)
        }).then(channels => {
            return new Promise((fulfill, reject) => {
                fulfill(channels.map(c => {
                    return this._channels[c.cid]
                }))
            })
        })
    }


    /**
     * Lists all Clients with a given Filter
     * @version 1.0
     * @async
     * @param {object} filter - Filter Object
     * @returns {Promise<TeamSpeakClient[]>} Promise object which returns an Array of TeamSpeak Clients
     */
    clientList(filter = {}) {
        return this.execute(
            "clientlist", ["-uid", "-away", "-voice", "-times", "-groups", "-info", "-icon", "-country"]
        ).then(clients => {
            return this._handleCache(this._clients, clients, "clid", TeamSpeakClient)
        }).then(clients => {
            return this.constructor._filter(clients, filter)
        }).then(clients => {
            return new Promise((fulfill, reject) => {
                fulfill(clients.map(c => {
                    return this._clients[String(c.clid)]
                }))
            })
        })
    }


    /**
     * Displays a list of files and directories stored in the specified channels file repository.
     * @version 1.6
     * @async
     * @param {number} cid - the channel id to check for
     * @param {string} [path=/] - the path to list
     * @param {string} [cpw] - the channel password
     * @returns {Promise<[]>} Promise object which returns an Array of Files
     */
    ftGetFileList(cid, path = "/", cpw = "") {
        return this.execute("ftgetfilelist", { cid, path, cpw })
    }


    /**
     * Displays detailed information about one or more specified files stored in a channels file repository.
     * @version 1.6
     * @async
     * @param {number} cid - the channel id to check for
     * @param {string} name - the filepath to receive
     * @param {string} [cpw] - the channel password
     * @returns {Promise<[]>} Promise object which returns an Array of Files
     */
    ftGetFileInfo(cid, name, cpw = "") {
        return this.execute("ftgetfileinfo", { cid, name, cpw })
    }


    /**
     * Displays detailed information about one or more specified files stored in a channels file repository
     * @version 1.6
     * @async
     * @param {number} serverftfid - Server File Transfer ID
     * @param {number} [del=1] - <Description Pending>
     * @returns {Promise<[]>} Promise object which returns an Array of Files
     */
    ftStop(serverftfid, del=1) {
        return this.execute("ftstop", { serverftfid, delete: del })
    }


    /**
     * Displays detailed information about one or more specified files stored in a channels file repository.
     * @version 1.6
     * @async
     * @param {number} cid - the channel id to check for
     * @param {string} name - path to the file to delete
     * @param {string} [cpw] - the channel password
     * @returns {Promise<[]>} Promise object which returns an Array of Files
     */
    ftDeleteFile(cid, name, cpw = "") {
        return this.execute("ftdeletefile", { cid, name, cpw })
    }


    /**
     * Displays detailed information about one or more specified files stored in a channels file repository.
     * @version 1.6
     * @async
     * @param {number} cid - the channel id to check for
     * @param {string} dirname - path to the directory
     * @param {string} [cpw] - the channel password
     * @returns {Promise<[]>} Promise object which returns an Array of Files
     */
    ftCreateDir(cid, dirname, cpw = "") {
        return this.execute("ftcreatedir", { cid, dirname, cpw })
    }


    /**
     * Displays detailed information about one or more specified files stored in a channels file repository.
     * @version 1.6
     * @async
     * @param {number} cid - the channel id to check for
     * @param {string} oldname - the path to the file which should be renamed
     * @param {string} newname - the path to the file with the new name
     * @param {string} [tcid] - target channel id if the file should be moved to a different channel
     * @param {string} [cpw] - the channel password from where the file gets renamed
     * @param {string} [tcpw] - the channel password from where the file will get transferred to
     * @returns {Promise<[]>} Promise object which returns an Array of Files
     */
    ftRenameFile(cid, oldname, newname, tcid, cpw = "", tcpw) {
        return this.execute("ftrenamefile", { cid, oldname, newname, tcid, cpw, tcpw })
    }


    /**
     * Initializes a file transfer upload. clientftfid is an arbitrary ID to identify the file transfer on client-side. On success, the server generates a new ftkey which is required to start uploading the file through TeamSpeak 3's file transfer interface.
     * @version 1.0
     * @async
     * @param {object} transfer - The Transfer Object
     * @param {object} [transfer.clientftfid] - Arbitary ID to Identify the Transfer
     * @param {string} transfer.name - Destination Filename
     * @param {number} transfer.size - Size of the File
     * @param {number} [transfer.cid=0] - Channel ID to upload to
     * @param {string} [transfer.cpw] - Channel Password of the Channel which will be uploaded to
     * @param {number} [transfer.overwrite=1] - <Description Pending>
     * @param {number} [transfer.resume=0] - <Description Pending>
     * @returns {Promise.<object>}
     */
    ftInitUpload(transfer) {
        if (!("clientftfid" in transfer)) transfer.clientftfid = Math.floor(Math.random() * 10000)
        if (!("cid" in transfer)) transfer.cid = 0
        if (!("resume" in transfer)) transfer.resume = 0
        if (!("overwrite" in transfer)) transfer.overwrite = 1
        return this.execute("ftinitupload", transfer)
    }


    /**
     * Initializes a file transfer download. clientftfid is an arbitrary ID to identify the file transfer on client-side. On success, the server generates a new ftkey which is required to start downloading the file through TeamSpeak 3's file transfer interface.
     * @version 1.0
     * @async
     * @param {object} transfer - The Transfer Object
     * @param {string} transfer.name - Filename to Download
     * @param {number} [transfer.clientftfid] - Arbitary ID to Identify the Transfer
     * @param {number} [transfer.cid=0] - Channel ID to upload to
     * @param {string} [transfer.cpw=""] - Channel Password of the Channel which will be uploaded to
     * @param {number} [transfer.seekpos=0] - <Description Pending File Startposition?>
     * @returns {Promise.<object>}
     */
    ftInitDownload(transfer) {
        if (!("clientftfid" in transfer)) transfer.clientftfid = Math.floor(Math.random() * 10000)
        if (!("seekpos" in transfer)) transfer.seekpos = 0
        if (!("cpw" in transfer)) transfer.cpw = ""
        if (!("cid" in transfer)) transfer.cid = 0
        if (!("path" in transfer)) transfer.path = "/"
        return this.execute("ftinitdownload", transfer)
    }

    /**
     * Returns an Icon with the given Name
     * @version 1.0
     * @async
     * @param {string} path - the path whith the filename where the file should be uploaded to
     * @param {string|buffer} data - The data to upload
     * @param {number} cid - Channel ID to upload to
     * @param {string} cpw - Channel Password of the Channel which will be uploaded to
     * @returns {Promise.<object>}
     */
    uploadFile(path, data, cid, cpw) {
        return new Promise((fulfill, reject) => {
            path = name.split("/")
            var name = "/"+path.pop()
            if (typeof data === "string") data = Buffer.from(data)
            return this.ftInitUpload({ path, name, cid, cpw, size: data.byteLength })
                .then(res => {
                    if (res.size === 0) return reject(new Error(res.msg))
                    new FileTransfer(this._config.host, res.port)
                        .upload(res.ftkey, data)
                        .then(fulfill)
                        .catch(reject)
                })
        })
    }


    /**
     * Returns an Icon with the given Name
     * @version 1.0
     * @async
     * @param {string} name - The Name of the Icon to retrieve
     * @returns {Promise.<object>}
     */
    downloadIcon(name) {
        return new Promise((fulfill, reject) => {
            return this.ftInitDownload({name: "/"+name})
                .then(res => {
                    if (res.size === 0) return reject(new Error(res.msg))
                    new FileTransfer(this._config.host, res.port)
                        .download(res.ftkey, res.size)
                        .then(fulfill)
                        .catch(reject)
                })
        })
    }


    /**
     * Gets the Icon Name of a resolveable Perm List
     * @version 1.0
     * @async
     * @returns {Promise.<object>}
     */
    getIconName(permlist) {
        return new Promise((fulfill, reject) => {
            permlist.then(perms => {
                var found = perms.some(perm => {
                    if (perm.permsid === "i_icon_id") {
                        fulfill("icon_"+((perm.permvalue < 0) ? perm.permvalue>>>0 : perm.permvalue))
                        return true
                    }
                })
                if (!found) reject(new Error("no icon found"))
            })
        })
    }


    /**
     * Closes the ServerQuery connection to the TeamSpeak 3 Server instance.
     * @version 1.0
     * @async
     * @returns {Promise.<object>}
     */
    quit() {
        return this.execute("quit")
    }


    /**
     * Cleans up the cache after a server deselect
     * @version 1.0
     * @async
     * @private
     * @param {object} promise - The Promise which will be waited for before the cleanup
     * @returns {Promise.<object>}
     */
    _cacheCleanUp(promise) {
        return new Promise((fulfill, reject) => {
            promise.then(res => {
                this._servergroups = []
                this._channels = []
                this._clients = []
                this._channelgroups = []
                fulfill(res)
            }).catch(reject)
        })
    }


    /**
     * Parses the whole Cache by given Objects
     * @version 1.0
     * @async
     * @private
     * @param {object} cache - The Cache Object
     * @param {object} list - The List to check against the Cache
     * @param {string} key - The Key used to identify the Object inside the Cache
     * @param {object} class - The Class which should be used
     * @returns {Promise.<object>}
     */
    _handleCache(cache, list, key, Class) {
        if (!Array.isArray(list)) var list = [list]
        return new Promise((fulfill, reject) => {
            var remainder = Object.keys(cache)
            list.forEach(l => {
                var k = String(l[key])
                if (remainder.indexOf(k) >= 0) {
                    cache[k].updateCache(l)
                    return remainder.splice(remainder.indexOf(k), 1)
                }
                cache[k] = new Class(this, l)
            })
            remainder.forEach(r => { delete cache[String(r)] })
            fulfill(list)
        })
    }


    /**
     * Filters an Object with given Option
     * @version 1.0
     * @private
     * @static
     * @async
     * @param {object} array - The Object which should get filtered
     * @param {object} filter - Filter Object
     * @returns {Promise.<object>}
     */
    static _filter(array, filter) {
        return new Promise(fulfill => {
            if (!Array.isArray(array)) array = [array]
            if (Object.keys(filter).length == 0)
                return fulfill(array)
            fulfill(array.filter(a => {
                for (var k in filter) {
                    if (!(k in a)) return false
                    if (filter[k] instanceof RegExp) return a[k].match(filter[k])
                    if (Array.isArray(filter[k])) return filter[k].indexOf(a[k]) >= 0
                    switch (typeof a[k]) {
                        case "number": return a[k] == parseFloat(filter[k])
                        case "string": return a[k] == filter[k]
                        case "object": return a[k].match(filter[k])
                    }
                }
            }))
        })
    }


    /**
     * Transforms an Input to an Array
     * @async
     * @version 1.0
     * @returns {any[]}
     */
    toArray(input) {
        return new Promise(fulfill => {
            if (typeof input == "undefined" || input === null) return fulfill([])
            if (!Array.isArray(input)) return fulfill([input])
            fulfill(input)
        })
    }


}


module.exports = TeamSpeak3
