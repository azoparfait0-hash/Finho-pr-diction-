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

// Analyse des 5 derniers matchs d'une équipe
app.get("/api/team-form", async (req, res) => {
    try {
        const team = Number(req.query.team);

        if (!Number.isInteger(team) || team <= 0) {
            return res.status(400).json({
                error: "Identifiant d'équipe invalide"
            });
        }

        if (!process.env.API_FOOTBALL_KEY) {
            return res.status(500).json({
                error: "Clé API non configurée"
            });
        }

        const response = await fetch(
            `https://v3.football.api-sports.io/fixtures?team=${team}&last=5&timezone=Africa/Ouagadougou`,
            {
                headers: {
                    "x-apisports-key": process.env.API_FOOTBALL_KEY
                }
            }
        );

        if (!response.ok) {
            return res.status(502).json({
                error: "Erreur lors de la récupération des matchs"
            });
        }

        const data = await response.json();

        if (data.errors && Object.keys(data.errors).length) {
            return res.status(502).json({
                error: "Erreur API-Football",
                details: data.errors
            });
        }

        const matches = (data.response || [])
            .filter(item =>
                ["FT", "AET", "PEN"].includes(item.fixture.status.short) &&
                item.goals.home !== null &&
                item.goals.away !== null
            )
            .map(item => {
                const isHome = item.teams.home.id === team;
                const scored = isHome ? item.goals.home : item.goals.away;
                const conceded = isHome ? item.goals.away : item.goals.home;

                const result = scored > conceded ? "V" :
                    scored < conceded ? "D" : "N";

                return {
                    date: item.fixture.date,
                    competition: item.league.name,
                    opponent: isHome ? item.teams.away.name : item.teams.home.name,
                    venue: isHome ? "Domicile" : "Extérieur",
                    score: `${scored}-${conceded}`,
                    goalsFor: scored,
                    goalsAgainst: conceded,
                    result
                };
            });

        const totals = matches.reduce((acc, match) => {
            acc[match.result]++;
            acc.goalsFor += match.goalsFor;
            acc.goalsAgainst += match.goalsAgainst;
            return acc;
        }, { V: 0, N: 0, D: 0, goalsFor: 0, goalsAgainst: 0 });

        res.json({
            teamId: team,
            matches,
            summary: {
                played: matches.length,
                wins: totals.V,
                draws: totals.N,
                losses: totals.D,
                goalsFor: totals.goalsFor,
                goalsAgainst: totals.goalsAgainst,
                points: totals.V * 3 + totals.N
            }
        });

    } catch (error) {
        res.status(500).json({
            error: error.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`FINHO fonctionne sur le port ${PORT}`);
});
