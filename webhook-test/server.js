import express from "express";

const app = express();
app.use(express.json());

app.post("/", (req, res) => {
    const event = req.headers["x-github-event"];

    if (event === "push") {
        console.log("Commit detected!");

        const repo = req.body.repository.full_name;
        const branch = req.body.ref;
        const commits = req.body.commits;

        console.log("Repo:", repo);
        console.log("Branch:", branch);
        console.log("Commits:", commits.length);
    }

    res.sendStatus(200);
});

app.listen(3000, () => {
    console.log("Server running on port 3000");
});