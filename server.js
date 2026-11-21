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

// =====================================
// CONNEXION GOAL API
// =====================================

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

// =====================================
// EXTRACTION DES BUTS
// =====================================

function getGoals(match) {
const rawHome =
match.homeTeamFtScore ?? match.homeTeamScore;

const rawAway =
    match.awayTeamFtScore ?? match.awayTeamScore;

if (
    rawHome === null ||
    rawHome === undefined ||
    rawAway === null ||
    rawAway === undefined ||
    rawHome === "" ||
    rawAway === ""
) {
    return null;
}

const home = Number(rawHome);
const away = Number(rawAway);

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

// =====================================
// HISTORIQUE DES ÉQUIPES
// =====================================

async function getTeamHistory(teamId) {
const result = await goalApiRequest(
"/teams/${encodeURIComponent(teamId)}/results"
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
            homeId: String(match.homeTeamId || ""),
            awayId: String(match.awayTeamId || ""),
            homeGoals: goals.home,
            awayGoals: goals.away
        };
    })
    .filter(match =>
        match &&
        match.homeId &&
        match.awayId
    )
    .sort((a, b) => {
        const dateA = Date.parse(a.date) || 0;
        const dateB = Date.parse(b.date) || 0;

        return dateB - dateA;
    })
    .slice(0, 10);

}

// =====================================
// STATISTIQUES PONDÉRÉES
// =====================================

function calculateTeamStats(matches, teamId, venue) {
const games = [];

for (const match of matches) {
    const isHome = String(match.homeId) === String(teamId);
    const isAway = String(match.awayId) === String(teamId);

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

if (!games.length) {
    return {
        played: 0,
        scored: 0,
        conceded: 0,
        wins: 0,
        draws: 0,
        losses: 0
    };
}

let totalWeight = 0;
let scored = 0;
let conceded = 0;

for (let i = 0; i < games.length; i++) {
    const weight = 1 / (1 + i * 0.15);

    totalWeight += weight;
    scored += games[i].scored * weight;
    conceded += games[i].conceded * weight;
}

return {
    played: games.length,

    scored: Number(
        (scored / totalWeight).toFixed(2)
    ),

    conceded: Number(
        (conceded / totalWeight).toFixed(2)
    ),

    wins: games.filter(
        g => g.scored > g.conceded
    ).length,

    draws: games.filter(
        g => g.scored === g.conceded
    ).length,

    losses: games.filter(
        g => g.scored < g.conceded
    ).length
};

}

// =====================================
// COMBINAISON DES STATISTIQUES
// =====================================

function blendStats(specific, overall) {
if (!overall.played) return specific;
if (!specific.played) return overall;

const weight = Math.min(
    0.6,
    specific.played / (specific.played + 4)
);

return {
    played: overall.played,

    scored: Number((
        specific.scored * weight +
        overall.scored * (1 - weight)
    ).toFixed(2)),

    conceded: Number((
        specific.conceded * weight +
        overall.conceded * (1 - weight)
    ).toFixed(2)),

    wins: overall.wins,
    draws: overall.draws,
    losses: overall.losses
};

}

// =====================================
// ANALYSE DE FORME DES 5 DERNIERS MATCHS
// =====================================

function calculateTeamForm(matches, teamId) {
const recentMatches = matches
.filter(match =>
String(match.homeId) === String(teamId) ||
String(match.awayId) === String(teamId)
)
.slice(0, 5);

const results = [];

let goalsScored = 0;
let goalsConceded = 0;

for (const match of recentMatches) {
    const isHome = String(match.homeId) === String(teamId);

    const scored = isHome
        ? match.homeGoals
        : match.awayGoals;

    const conceded = isHome
        ? match.awayGoals
        : match.homeGoals;

    let result;

    if (scored > conceded) {
        result = "V";
    } else if (scored === conceded) {
        result = "N";
    } else {
        result = "D";
    }

    results.push({
        result,
        scored,
        conceded,
        date: match.date
    });

    goalsScored += scored;
    goalsConceded += conceded;
}

const wins = results.filter(
    item => item.result === "V"
).length;

const draws = results.filter(
    item => item.result === "N"
).length;

const losses = results.filter(
    item => item.result === "D"
).length;

const points = wins * 3 + draws;

const index = results.length
    ? Math.round(points / (results.length * 3) * 100)
    : 0;

// Série actuelle
let currentStreak = {
    type: "Aucune",
    count: 0
};

if (results.length) {
    const firstResult = results[0].result;

    const labels = {
        V: "Victoires",
        N: "Matchs nuls",
        D: "Défaites"
    };

    let count = 0;

    for (const match of results) {
        if (match.result !== firstResult) break;
        count++;
    }

    currentStreak = {
        type: labels[firstResult],
        count
    };
}

// Plus longue série de victoires et de défaites
let longestWinStreak = 0;
let longestLossStreak = 0;

let winStreak = 0;
let lossStreak = 0;

for (const match of results) {
    if (match.result === "V") {
        winStreak++;
        lossStreak = 0;
    } else if (match.result === "D") {
        lossStreak++;
        winStreak = 0;
    } else {
        winStreak = 0;
        lossStreak = 0;
    }

    longestWinStreak = Math.max(
        longestWinStreak,
        winStreak
    );

    longestLossStreak = Math.max(
        longestLossStreak,
        lossStreak
    );
}

return {
    matchesPlayed: results.length,

    lastFiveResults: results.map(
        item => item.result
    ),

    wins,
    draws,
    losses,

    points,

    formIndex: index,

    goalsScored,
    goalsConceded,

    averageGoalsScored: results.length
        ? Number((goalsScored / results.length).toFixed(2))
        : 0,

    averageGoalsConceded: results.length
        ? Number((goalsConceded / results.length).toFixed(2))
        : 0,

    currentStreak,

    longestWinStreak,
    longestLossStreak,

    matchDetails: results
};

}

// =====================================
// LOI DE POISSON
// =====================================

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

// =====================================
// MOTEUR DE PRÉDICTION FINHO
// =====================================

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

lambdaHome = Math.max(
    0.15,
    Math.min(4, lambdaHome)
);

lambdaAway = Math.max(
    0.15,
    Math.min(4, lambdaAway)
);

let homeWin = 0;
let draw = 0;
let awayWin = 0;

let over25 = 0;
let under25 = 0;
let btts = 0;

let gridTotal = 0;

const scores = [];

for (let h = 0; h <= 10; h++) {
    for (let a = 0; a <= 10; a++) {
        const probability =
            poisson(lambdaHome, h) *
            poisson(lambdaAway, a);

        gridTotal += probability;

        if (h > a) {
            homeWin += probability;
        } else if (h === a) {
            draw += probability;
        } else {
            awayWin += probability;
        }

        if (h + a > 2) {
            over25 += probability;
        } else {
            under25 += probability;
        }

        if (h > 0 && a > 0) {
            btts += probability;
        }

        scores.push({
            score: `${h}-${a}`,
            probability
        });
    }
}

const percentage = value =>
    Number((
        value / gridTotal * 100
    ).toFixed(1));

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
        noBtts: percentage(gridTotal - btts)
    },

    expectedGoals: {
        home: Number(lambdaHome.toFixed(2)),
        away: Number(lambdaAway.toFixed(2))
    },

    exactScores: scores.slice(0, 5).map(item => ({
        score: item.score,

        probability: Number(
            (item.probability / gridTotal * 100).toFixed(2)
        )
    }))
};

}

// =====================================
// QUALITÉ DES DONNÉES
// =====================================

function calculateDataQuality(homeCount, awayCount) {
const total = homeCount + awayCount;

const score = Math.min(
    100,
    Math.round(total / 20 * 100)
);

let label;

if (score >= 80) {
    label = "Historique complet";
} else if (score >= 50) {
    label = "Historique partiel";
} else {
    label = "Historique insuffisant";
}

return {
    score,
    label,
    matchesAvailable: total,
    note: "Cet indicateur mesure la quantité de données, pas la précision réelle des prédictions."
};

}

// =====================================
// MATCHS DU JOUR
// =====================================

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

            const parts = score.match(
                /(\d+)\s*-\s*(\d+)/
            );

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
                        match.leagueName ||
                        "Football"
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

// =====================================
// HISTORIQUE D'UNE ÉQUIPE
// =====================================

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

// =====================================
// ANALYSE ET PRÉDICTION FINHO V3
// =====================================

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

    if (
        homeHistory.length < 3 ||
        awayHistory.length < 3
    ) {
        return res.status(422).json({
            error: "Historique insuffisant pour une analyse fiable",
            homeMatches: homeHistory.length,
            awayMatches: awayHistory.length
        });
    }

    // Statistiques domicile

    const homeHome = calculateTeamStats(
        homeHistory,
        homeId,
        "home"
    );

    const homeAll = calculateTeamStats(
        homeHistory,
        homeId,
        "all"
    );

    // Statistiques extérieur

    const awayAway = calculateTeamStats(
        awayHistory,
        awayId,
        "away"
    );

    const awayAll = calculateTeamStats(
        awayHistory,
        awayId,
        "all"
    );

    // Combinaison des performances

    const homeStats = blendStats(
        homeHome,
        homeAll
    );

    const awayStats = blendStats(
        awayAway,
        awayAll
    );

    // Analyse de forme

    const homeForm = calculateTeamForm(
        homeHistory,
        homeId
    );

    const awayForm = calculateTeamForm(
        awayHistory,
        awayId
    );

    // Comparaison des formes

    const formDifference =
        homeForm.formIndex - awayForm.formIndex;

    let formAdvantage;

    if (formDifference > 10) {
        formAdvantage = "Avantage de forme domicile";
    } else if (formDifference < -10) {
        formAdvantage = "Avantage de forme extérieur";
    } else {
        formAdvantage = "Formes relativement équilibrées";
    }

    // Prédiction

    const prediction = calculatePrediction(
        homeStats,
        awayStats
    );

    // Qualité des données

    const dataQuality = calculateDataQuality(
        homeHistory.length,
        awayHistory.length
    );

    const data = {
        success: true,

        engine: "FINHO Statistical Engine V3",

        teams: {
            home: {
                id: homeId,
                matchesAnalysed: homeHistory.length,
                statistics: homeStats,
                overallStatistics: homeAll,
                homeStatistics: homeHome,
                form: homeForm
            },

            away: {
                id: awayId,
                matchesAnalysed: awayHistory.length,
                statistics: awayStats,
                overallStatistics: awayAll,
                awayStatistics: awayAway,
                form: awayForm
            }
        },

        formComparison: {
            homeIndex: homeForm.formIndex,
            awayIndex: awayForm.formIndex,
            difference: formDifference,
            advantage: formAdvantage
        },

        prediction,

        dataQuality,

        note: "Estimations statistiques basées sur les résultats historiques et la forme récente. Elles ne garantissent pas le résultat d'un match."
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

// =====================================
// DÉMARRAGE
// =====================================

app.listen(PORT, () => {
console.log(
"FINHO PRÉDICTION V3 fonctionne sur le port ${PORT}"
);
});
