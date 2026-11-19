const express = require("express");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

let cache = {
    data: null,
    date: null,
    time: 0
};

app.get("/api/fixtures", async (req, res) => {
    try {
        const date = req.query.date ||
            new Date().toLocaleDateString("en-CA", {
                timeZone: "Africa/Ouagadougou"
            });

        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({
                error: "Date invalide"
            });
        }

        if (!process.env.API_FOOTBALL_KEY) {
            return res.status(500).json({
                error: "Clé API non configurée"
            });
        }

        if (
            cache.data &&
            cache.date === date &&
            Date.now() - cache.time < 15 * 60 * 1000
        ) {
            return res.json(cache.data);
        }

        const response = await fetch(
            `https://v3.football.api-sports.io/fixtures?date=${date}&timezone=Africa/Ouagadougou`,
            {
                headers: {
                    "x-apisports-key":
                        process.env.API_FOOTBALL_KEY
                }
            }
        );

        if (!response.ok) {
            throw new Error("Erreur API-Football");
        }

        const data = await response.json();

        if (data.errors && Object.keys(data.errors).length) {
            return res.status(502).json({
                error: "Erreur retournée par API-Football",
                details: data.errors
            });
        }

        cache = {
            data,
            date,
            time: Date.now()
        };

        res.json(data);

    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`FINHO fonctionne sur le port ${PORT}`);
});
