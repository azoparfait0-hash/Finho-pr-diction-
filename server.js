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

const analysisCache = new Map();

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

// EXTRACTION DES BUTS
function getGoals(match) {
    const home = Number(
        match.homeTeamFtScore ?? match.homeTeamScore
    );

    const away = Number(
        match.awayTeamFtScore ?? match.awayTeamScore
    );

    if (
        !Number.isInteger(home) ||
        !Number.isInteger(away) ||
        home < 0 ||
        away < 0
    ) {
        return null;
    }

    return { home, away };
}

// RÉCUPÉRATION DES DERNIERS MATCHS
async function getTeamHistory(teamId) {
    const result = await goalApiRequest(
        `/teams/${encodeURIComponent(teamId)}/results`
    );

    const matches = Array.isArray(result.data)
        ? result.data
        : [];

    return matches
        .filter(match =>
            match.matchStatus === "FINISHED" ||
            match.status === "FINISHED"
        )
        .map(match => {
            const goals = getGoals(match);

            if (!goals) return null;

            return {
                date: match.matchDate || match.date || "",
                homeId: match.homeTeamId,
                awayId: match.awayTeamId,
                homeGoals: goals.home,
                awayGoals: goals.away
            };
        })
        .filter(Boolean)
        .sort((a, b) =>
            b.date.localeCompare(a.date)
        )
        .slice(0, 10);
}

// STATISTIQUES D'UNE ÉQUIPE
function calculateTeamStats(matches, teamId, venue) {
    let games = [];

    for (const match of matches) {
        const isHome = match.homeId === teamId;
        const isAway = match.awayId === teamId;

        if (!isHome && !isAway) continue;

        if (venue === "home" && !isHome) continue;
        if (venue === "away" && !isAway) continue;

        games.push({
            scored: isHome
                ? match.homeGoals
                : match.awayGoals,

            conceded: isHome
                ? match.awayGoals
                : match.homeGoals
        });
    }

    const count = games.length;

    if (!count) {
        return {
            played: 0,
            scored: 0,
            conceded: 0,
            wins: 0,
            draws: 0,
            losses: 0
        };
    }

    const scored = games.reduce(
        (sum, game) => sum + game.scored, 0
    );

    const conceded = games.reduce(
        (sum, game) => sum + game.conceded, 0
    );

    return {
        played: count,
        scored: Number((scored / count).toFixed(2)),
        conceded: Number((conceded / count).toFixed(2)),
        wins: games.filter(
            game => game.scored > game.conceded
        ).length,
        draws: games.filter(
            game => game.scored === game.conceded
        ).length,
        losses: games.filter(
            game => game.scored < game.conceded
        ).length
    };
}

// CALCUL DE POISSON
function poisson(lambda, goals) {
    let factorial = 1;

    for (let i = 1; i <= goals; i++) {
        factorial *= i;
    }

    return (
        Math.exp(-lambda) *
        Math.pow(lambda, goals) /
        factorial
    );
}

// MOTEUR DE PRÉDICTION FINHO
function calculatePrediction(homeStats, awayStats) {
    const homeFor = homeStats.scored;
    const homeAgainst = homeStats.conceded;

    const awayFor = awayStats.scored;
    const awayAgainst = awayStats.conceded;

    let lambdaHome = (
        homeFor + awayAgainst
    ) / 2 * 1.08;

    let lambdaAway = (
        awayFor + homeAgainst
    ) / 2 * 0.94;

    lambdaHome = Math.max(0.15, Math.min(4, lambdaHome));
    lambdaAway = Math.max(0.15, Math.min(4, lambdaAway));

    let homeWin = 0;
    let draw = 0;
    let awayWin = 0;

    let over25 = 0;
    let under25 = 0;
    let btts = 0;

    const scores = [];

    for (let h = 0; h <= 8; h++) {
        for (let a = 0; a <= 8; a++) {
            const probability =
                poisson(lambdaHome, h) *
                poisson(lambdaAway, a);

            if (h > a) homeWin += probability;
            else if (h === a) draw += probability;
            else awayWin += probability;

            if (h + a > 2) over25 += probability;
            else under25 += probability;

            if (h > 0 && a > 0) btts += probability;

            scores.push({
                score: `${h}-${a}`,
                probability
            });
        }
    }

    const total = homeWin + draw + awayWin;

    const percentage = value =>
        Number((value / total * 100).toFixed(1));

    scores.sort(
        (a, b) => b.probability - a.probability
    );

    return {
        probabilities: {
            homeWin: percentage(homeWin),
            draw: percentage(draw),
            awayWin: percentage(awayWin)
        },

        goals: {
            over25: percentage(over25),
            under25: percentage(under25),
            btts: percentage(btts),
            noBtts: percentage(1 - btts)
        },

        expectedGoals: {
            home: Number(lambdaHome.toFixed(2)),
            away: Number(lambdaAway.toFixed(2))
        },

        exactScores: scores.slice(0, 5).map(item => ({
            score: item.score,
            probability: Number(
                (item.probability * 100).toFixed(2)
            )
        }))
    };
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

// ANALYSE ET PRÉDICTION FINHO
app.get("/api/analysis/:homeId/:awayId", async (req, res) => {
    try {
        const { homeId, awayId } = req.params;

        if (
            !/^[a-zA-Z0-9_-]+$/.test(homeId) ||
            !/^[a-zA-Z0-9_-]+$/.test(awayId) ||
            homeId === awayId
        ) {
            return res.status(400).json({
                error: "Identifiants invalides"
            });
        }

        const key = `${homeId}_${awayId}`;
        const cached = analysisCache.get(key);

        if (
            cached &&
            Date.now() - cached.time < 30 * 60 * 1000
        ) {
            return res.json(cached.data);
        }

        const [homeHistory, awayHistory] =
            await Promise.all([
                getTeamHistory(homeId),
                getTeamHistory(awayId)
            ]);

        if (!homeHistory.length || !awayHistory.length) {
            return res.status(422).json({
                error: "Historique insuffisant pour analyser ce match"
            });
        }

        const homeHome = calculateTeamStats(
            homeHistory, homeId, "home"
        );

        const homeAll = calculateTeamStats(
            homeHistory, homeId, "all"
        );

        const awayAway = calculateTeamStats(
            awayHistory, awayId, "away"
        );

        const awayAll = calculateTeamStats(
            awayHistory, awayId, "all"
        );

        // Utiliser les statistiques domicile/extérieur
        // si au moins 3 matchs sont disponibles.
        const homeStats = homeHome.played >= 3
            ? homeHome
            : homeAll;

        const awayStats = awayAway.played >= 3
            ? awayAway
            : awayAll;

        const prediction = calculatePrediction(
            homeStats,
            awayStats
        );

        const totalMatches =
            homeHistory.length + awayHistory.length;

        const confidence = Math.min(
            85,
            Math.round(totalMatches / 20 * 100)
        );

        const data = {
            success: true,
            engine: "FINHO Statistical Engine",
            teams: {
                home: {
                    id: homeId,
                    matchesAnalysed: homeHistory.length,
                    statistics: homeStats
                },
                away: {
                    id: awayId,
                    matchesAnalysed: awayHistory.length,
                    statistics: awayStats
                }
            },
            prediction,
            confidence: {
                score: confidence,
                label: confidence >= 70
                    ? "Données assez nombreuses"
                    : confidence >= 40
                        ? "Données limitées"
                        : "Faible quantité de données"
            },
            note: "Estimations statistiques, pas des garanties."
        };

        analysisCache.set(key, {
            data,
            time: Date.now()
        });

        res.json(data);

    } catch (error) {
        res.status(502).json({
            error: "Erreur du moteur FINHO",
            details: error.message
        });
    }
});

// DÉMARRAGE
app.listen(PORT, () => {
    console.log(`FINHO fonctionne sur le port ${PORT}`);
});
