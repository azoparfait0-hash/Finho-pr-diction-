// =====================================
// HISTORIQUE DES ÉQUIPES
// =====================================

async function getTeamHistory(teamId) {
const result = await goalApiRequest(
"/teams/${encodeURIComponent(teamId)}/results"
);

if (!result || !result.success || !Array.isArray(result.data)) {
    return [];
}

return result.data
    .filter(match => match.matchStatus === "FINISHED")
    .map(match => {
        const homeGoals = Number(
            match.homeTeamFtScore ?? match.homeTeamScore
        );

        const awayGoals = Number(
            match.awayTeamFtScore ?? match.awayTeamScore
        );

        if (
            !Number.isInteger(homeGoals) ||
            !Number.isInteger(awayGoals) ||
            homeGoals < 0 ||
            awayGoals < 0
        ) {
            return null;
        }

        return {
            date: match.matchDate || "",
            homeId: String(match.homeTeamId || ""),
            awayId: String(match.awayTeamId || ""),
            homeGoals,
            awayGoals
        };
    })
    .filter(match => match && match.homeId && match.awayId)
    .sort((a, b) => {
        return (Date.parse(b.date) || 0) -
               (Date.parse(a.date) || 0);
    })
    .slice(0, 10);

}
