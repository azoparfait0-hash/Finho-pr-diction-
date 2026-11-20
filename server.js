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

        if (!process.env.GOAL_API_KEY) {
            return res.status(500).json({
                error: "Clé GOAL API non configurée"
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
            `https://api.goal-api.com/v1/fixtures/date/${date}`,
            {
                headers: {
                    Authorization: `Bearer ${process.env.GOAL_API_KEY}`
                }
            }
        );

        const result = await response.json();

        if (!response.ok || result.success === false) {
            return res.status(response.status || 502).json({
                error: "Erreur GOAL API",
                details: result.message || result
            });
        }

        const matches = Array.isArray(result.data)
            ? result.data
            : [];

        const data = {
            response: matches.map(match => {
                const score = String(match.score || "");
                const parts = score.match(/(\d+)\s*-\s*(\d+)/);

                return {
                    fixture: {
                        id: match.id,
                        date: match.date || match.matchDate ||
                            match.kickoffUtc || `${date}T12:00:00`,
                        status: {
                            short: match.status === "FINISHED"
                                ? "FT"
                                : match.status || "NS"
                        }
                    },
                    league: {
                        name: match.league?.name ||
                            match.leagueName || "Football"
                    },
                    teams: {
                        home: {
                            name: match.homeTeam?.name || "Domicile"
                        },
                        away: {
                            name: match.awayTeam?.name || "Extérieur"
                        }
                    },
                    goals: {
                        home: parts ? Number(parts[1]) : null,
                        away: parts ? Number(parts[2]) : null
                    }
                };
            })
        };

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
