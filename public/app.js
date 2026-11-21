const matchContainer = document.getElementById("matches-list");

function getBurkinaDate() {
const parts = new Intl.DateTimeFormat("en-CA", {
timeZone: "Africa/Ouagadougou",
year: "numeric",
month: "2-digit",
day: "2-digit"
}).formatToParts(new Date());

const values = {};
parts.forEach(part => values[part.type] = part.value);

return `${values.year}-${values.month}-${values.day}`;

}

// CRÉATION D'UN ÉLÉMENT HTML SÉCURISÉ
function createElement(tag, className, text) {
const element = document.createElement(tag);

if (className) element.className = className;
if (text !== undefined) element.textContent = text;

return element;

}

// AFFICHAGE DE L'ANALYSE
async function analyzeMatch(homeId, awayId, resultContainer, button) {
if (!homeId || !awayId) {
resultContainer.textContent =
"Identifiants des équipes indisponibles.";
return;
}

button.disabled = true;
button.textContent = "Analyse en cours...";

resultContainer.textContent =
    "FINHO analyse les performances des deux équipes...";

try {
    const response = await fetch(
        `/api/analysis/${encodeURIComponent(homeId)}/${encodeURIComponent(awayId)}`
    );

    const data = await response.json();

    if (!response.ok || !data.success) {
        throw new Error(
            data.error || "Analyse impossible."
        );
    }

    resultContainer.replaceChildren();

    const prediction = data.prediction;
    const probabilities = prediction.probabilities;
    const goals = prediction.goals;

    const title = createElement(
        "h3",
        "gold",
        "ANALYSE FINHO"
    );

    const resultSection = createElement("div", "analysis-section");

    resultSection.appendChild(
        createElement("h4", "", "Résultat du match")
    );

    resultSection.appendChild(
        createElement(
            "p",
            "info",
            `Victoire domicile : ${probabilities.homeWin}%`
        )
    );

    resultSection.appendChild(
        createElement(
            "p",
            "info",
            `Match nul : ${probabilities.draw}%`
        )
    );

    resultSection.appendChild(
        createElement(
            "p",
            "info",
            `Victoire extérieur : ${probabilities.awayWin}%`
        )
    );

    const goalsSection = createElement(
        "div",
        "analysis-section"
    );

    goalsSection.appendChild(
        createElement("h4", "", "Analyse des buts")
    );

    goalsSection.appendChild(
        createElement(
            "p",
            "info",
            `Plus de 2,5 buts : ${goals.over25}%`
        )
    );

    goalsSection.appendChild(
        createElement(
            "p",
            "info",
            `Moins de 2,5 buts : ${goals.under25}%`
        )
    );

    goalsSection.appendChild(
        createElement(
            "p",
            "info",
            `Les deux équipes marquent : ${goals.btts}%`
        )
    );

    goalsSection.appendChild(
        createElement(
            "p",
            "info",
            `Au moins une équipe ne marque pas : ${goals.noBtts}%`
        )
    );

    const expectedSection = createElement(
        "div",
        "analysis-section"
    );

    expectedSection.appendChild(
        createElement("h4", "", "Buts attendus")
    );

    expectedSection.appendChild(
        createElement(
            "p",
            "info",
            `Domicile : ${prediction.expectedGoals.home}`
        )
    );

    expectedSection.appendChild(
        createElement(
            "p",
            "info",
            `Extérieur : ${prediction.expectedGoals.away}`
        )
    );

    const scoreSection = createElement(
        "div",
        "analysis-section"
    );

    scoreSection.appendChild(
        createElement("h4", "", "Top 5 des scores exacts")
    );

    prediction.exactScores.forEach((item, index) => {
        scoreSection.appendChild(
            createElement(
                "p",
                "gold",
                `${index + 1}. ${item.score} — ${item.probability}%`
            )
        );
    });

    const quality = data.dataQuality;

    const qualitySection = createElement(
        "p",
        "info",
        `Données : ${quality.score}% — ${quality.label} (${quality.matchesAvailable} matchs)`
    );

    const note = createElement(
        "p",
        "info",
        data.note
    );

    resultContainer.append(
        title,
        resultSection,
        goalsSection,
        expectedSection,
        scoreSection,
        qualitySection,
        note
    );

    button.textContent = "Analyse terminée";

} catch (error) {
    resultContainer.textContent =
        error.message || "Erreur pendant l'analyse.";

    button.disabled = false;
    button.textContent = "RÉESSAYER L'ANALYSE";
}

}

// CHARGEMENT DES MATCHS
async function loadMatches() {
if (!matchContainer) return;

matchContainer.textContent = "Chargement des matchs...";

try {
    const date = getBurkinaDate();

    const response = await fetch(
        `/api/fixtures?date=${date}`
    );

    if (!response.ok) {
        throw new Error(
            "Impossible de récupérer les matchs."
        );
    }

    const data = await response.json();

    matchContainer.replaceChildren();

    if (!data.response || data.response.length === 0) {
        matchContainer.textContent =
            "Aucun match disponible pour cette date.";
        return;
    }

    data.response.forEach(item => {
        const card = createElement("div", "card");

        const league = createElement(
            "p",
            "info",
            item.league.name
        );

        const teams = createElement(
            "h3",
            "gold",
            `${item.teams.home.name} VS ${item.teams.away.name}`
        );

        const time = createElement(
            "p",
            "info",
            new Date(item.fixture.date).toLocaleTimeString(
                "fr-FR",
                {
                    timeZone: "Africa/Ouagadougou",
                    hour: "2-digit",
                    minute: "2-digit"
                }
            )
        );

        const analysisButton = createElement(
            "button",
            "analyze-button",
            "ANALYSER LE MATCH"
        );

        const resultContainer = createElement(
            "div",
            "analysis-result"
        );

        analysisButton.addEventListener("click", () => {
            analyzeMatch(
                item.teams.home.id,
                item.teams.away.id,
                resultContainer,
                analysisButton
            );
        });

        card.append(
            league,
            teams,
            time,
            analysisButton,
            resultContainer
        );

        matchContainer.appendChild(card);
    });

} catch (error) {
    matchContainer.textContent =
        error.message + " Vérifie la connexion au serveur.";
}

}

// LANCEMENT
loadMatches();
