const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { body, query, oneOf, validationResult } = require("express-validator");

const Config = require("./config/config.json");
const AUTH_PUBLIC_KEY = fs.readFileSync(__dirname + '/config' + '/public.key');

const CLIENT_WHITELIST = Config.ClientWhiteList;
const PORT = Config.Port;

const DB_HOST = Config.DBHost;
const DB_NAME = Config.DBName;

mongoose.connect(DB_HOST, {
    useCreateIndex: true,
    useNewUrlParser: true,
    useUnifiedTopology: true,
    useFindAndModify: false,
    dbName: DB_NAME
});

let User;
let UserSchema;

let db = mongoose.connection;

db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', () => {
    console.log("Connected to database...");

    UserSchema = new mongoose.Schema({
        level: Number,
        exp: Number,
        totalKill: Number,
        maxKill: Number,
        totalPlay: Number,
        friends: [mongoose.Schema.Types.ObjectId]
    });

    User = mongoose.model('User', UserSchema);
});

let app = express();

app.use(cors());
app.use(bodyParser.json());

function extractTokenFromHeader(header) {
    return header.split(" ")[1];
}

//get user game related info (public info)
app.get("/users/info", [
    query("client_id").isIn(CLIENT_WHITELIST),
    query("user_id").exists()
],
(req, res) => {
    try {
        validationResult(req).throw();
        
        let user_id = [];

        if ( Array.isArray(req.query.user_id)) {
            user_id = req.query.user_id;
        }
        else {
            user_id.push(req.query.user_id);
        }

        const result_id = user_id.map(item => {
            return mongoose.Types.ObjectId(item)
        });

        User.aggregate([
            {
                "$match": {
                    _id: { "$in": result_id }
                }
            },
            {
                "$project": {
                    "level": {
                        "$floor": {
                            "$divide": [ "$exp", 200 ]
                        }
                    },
                    totalKill: 1,
                    maxKill: 1,
                    exp: 1,
                    totalPlay: 1,
                    friends: 1
                }
            }
        ]).exec((err, result) => {
            if (err) {
                console.log(err);
                res.status(500).send();
                return;
            }

            if (result.length <= 0) {
                res.status(404).send();
                return;
            }

            const info = result.map(item => {
                let clone = Object.assign({ id: item._id }, item, {_id: undefined});
                return clone;
            });

            res.status(200).json(info);
        });
    }
    catch (err) {
        console.log(err);
        res.status(400).send();
    }
});

//get only friend list of users
app.get("/users/friends", [
    query("client_id").isIn(CLIENT_WHITELIST),
    query("user_id").exists()
]
,(req, res) => {
    try {
        validationResult(req).throw();

        User.find().where('_id').in(req.query.user_id).exec((err, doc) => {
            if (err) {
                res.status(500).send();
                return;
            }

            if (doc == undefined) {
                res.status(404).send();
                return;
            }

            let info = [];

            for (let element of doc) {
                info.push({
                    id: element._id,
                    friends: element.friends
                });
            }

            res.status(200).json(info);
        });
    }
    catch (err) {
        res.status(400).send();
    }
});

// Protect every route underneath with access token
app.use([
    query("client_id").isIn(CLIENT_WHITELIST)
],
(req, res, next) => {
    try {
        validationResult(req).throw();

        if (!req.headers.authorization) {
            return res.status(403).json({ error: 'No credentials sent!' });
        }

        next();
    }
    catch (err) {
        return res.status(400).send();
    }
});

//add friend
//todo : add pending friend request
app.post("/users/addfriend", [
    body("user_id").exists()
],
(req, res) => {
    try {
        validationResult(req).throw();

        const token = extractTokenFromHeader(req.headers.authorization);

        jwt.verify(token, AUTH_PUBLIC_KEY, (err, payload) => {
            if (err) {
                res.status(401).send({ auth: false, message: 'Failed to authenticate token.' });
                return;
            }

            if (payload.sub == req.body.user_id) {
                res.status(409).send();
                return;
            }

            User.findByIdAndUpdate({
                _id: payload.sub,
            },
            {
                $addToSet: {
                    friends: mongoose.Types.ObjectId(req.body.user_id)
                }
            },
            {
                new: true,
                upsert: true
            }, (err, doc) => {
                if (err) {
                    console.log(err);
                    res.status(500).send();
                    return;
                }
    
                res.status(201).send();
            });
        });
    }
    catch (err) {
        res.status(400).send();
    }
});

//remove friend
app.post("/users/removefriend", [
    body("user_id").exists()
],
(req, res) => {
    try {
        validationResult(req).throw();

        const token = extractTokenFromHeader(req.headers.authorization);

        jwt.verify(token, AUTH_PUBLIC_KEY, (err, payload) => {
            if (err) {
                res.status(401).send({ saved: false, auth: false, message: 'Failed to authenticate token.' });
                return;
            }

            if (payload.sub == req.body.user_id) {
                res.status(409).send();
                return;
            }

            User.findByIdAndUpdate({
                _id: payload.sub,
            },
            {
                $pull: {
                    friends: mongoose.Types.ObjectId(req.body.user_id)
                }
            },
            {
                new: true,
                upsert: false
            }, (err, doc) => {
                if (err) {
                    console.log(err);
                    res.status(500).send();
                    return;
                }
    
                res.status(200).send();
            });
        });
    }
    catch (err) {
        res.status(400).send();
    }
});

//save game progress
app.post("/users/gamesave/update", [
    body("progress").isArray()
],
(req, res) => {
    try {
        validationResult(req).throw();

        const token = extractTokenFromHeader(req.headers.authorization);

        //todo: in auth -> don't forget to grant scope of 'write:gamesave' only in client_id of game server (with client credentials flow)
        //todo: detect scope 'write:gamesave' (only this scope can alter gamesave)
        jwt.verify(token, AUTH_PUBLIC_KEY, (err, payload) => {
            if (err) {
                res.status(401).send({ saved: false, auth: false, message: 'Failed to authenticate token.' });
                return;
            }

            const operation = req.body.progress.map((item) => {
                return {
                    "updateOne": {
                        "filter": {
                            "_id": item.id,
                        },
                        "update": {
                            $inc: {
                                "totalPlay": 1,
                                "totalKill": item.totalKill,
                                "exp": item.exp
                            },
                            $max: {
                                "maxKill": item.maxKill
                            }
                        },
                        upsert: true
                    }
                }
            });

            User.bulkWrite(operation, (err, result) => {
                if (err) {
                    res.status(500).send(err);
                }
                else {
                    res.status(200).send({ saved: true });
                }
            });
        });
    }
    catch (err) {
        console.log(err);
        return res.status(400).send();
    }
});

app.listen(process.env.PORT || PORT, () => {
    console.log("Resource server has started...");
});
