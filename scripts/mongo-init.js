const app = db.getSiblingDB('launchpad');
app.createUser({
    user: 'launchpad',
    pwd: process.env.MONGO_APP_PASSWORD,
    roles: [{ role: 'readWrite', db: 'launchpad' }],
});
