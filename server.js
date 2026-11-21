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

const predictionCache = new Map();

// CONNEXION GOAL API
async function goalApiRequest(path) {
    if (!process.env.GOAL_API_KEY) {
        throw new Error("Clé GOAL API non configurée");
    }

    const response = await fetch(
        `https://api.goal-api.com/v1${path}`,
        {
            headers: {
                Authorization: `Bearer ${process.env.GOAL_API_KEY}`,
                Accept: "application/json"
            }
        }
    );

    let result;

    try {
        result = await response.json();
    } catch {
        throw new Error("Réponse GOAL API invalide");
    }

    if (!response.ok || result.success === false) {
        throw new Error(JSON.stringify({
            status: response.status,
            response: result
        }));
    }

    return result;
}

// MATCHS DU JOUR
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

        if (
            cache.data &&
            cache.date === date &&
            Date.now() - cache.time < 15 * 60 * 1000
        ) {
            return res.json(cache.data);
        }

        const result = await goalApiRequest(
            `/fixtures/date/${date}`
        );

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
                        date: match.kickoffUtc ||
                            match.date ||
                            match.matchDate ||
                            `${date}T12:00:00`,
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
                            id: match.homeTeam?.id || null,
                            name: match.homeTeam?.name || "Domicile"
                        },
                        away: {
                            id: match.awayTeam?.id || null,
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
            error: "Impossible de récupérer les matchs",
            details: error.message
        });
    }
});

// HISTORIQUE D'UNE ÉQUIPE
app.get("/api/teams/:id/results", async (req, res) => {
    try {
        const id = req.params.id;

        if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
            return res.status(400).json({
                error: "Identifiant invalide"
            });
        }

        const result = await goalApiRequest(
            `/teams/${encodeURIComponent(id)}/results`
        );

        res.json(result);

    } catch (error) {
        res.status(502).json({
            error: "Impossible de récupérer les résultats",
            details: error.message
        });
    }
});

// PRÉDICTIONS D'UN MATCH
app.get("/api/predictions/:id", async (req, res) => {
    try {
        const id = req.params.id;

        if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
            return res.status(400).json({
                error: "Identifiant de match invalide"
            });
        }

        const cached = predictionCache.get(id);

        if (
            cached &&
            Date.now() - cached.time < 60 * 60 * 1000
        ) {
            return res.json(cached.data);
        }

        const result = await goalApiRequest(
            `/fixtures/${encodeURIComponent(id)}/predictions`
        );

        predictionCache.set(id, {
            data: result,
            time: Date.now()
        });

        res.json(result);

    } catch (error) {
        res.status(502).json({
            error: "Impossible de récupérer les prédictions",
            details: error.message
        });
    }
});

// DÉMARRAGE
app.listen(PORT, () => {
    console.log(`FINHO fonctionne sur le port ${PORT}`);
});
