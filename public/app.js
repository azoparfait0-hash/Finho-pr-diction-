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

async function loadMatches() {
    if (!matchContainer) return;

    matchContainer.textContent = "Chargement des matchs...";

    try {
        const date = getBurkinaDate();
        const response = await fetch(`/api/fixtures?date=${date}`);

        if (!response.ok) {
            throw new Error("Impossible de récupérer les matchs.");
        }

        const data = await response.json();
        matchContainer.replaceChildren();

        if (!data.response || data.response.length === 0) {
            matchContainer.textContent = "Aucun match disponible pour cette date.";
            return;
        }

        data.response.forEach(item => {
            const card = document.createElement("div");
            card.className = "card";

            const league = document.createElement("p");
            league.className = "info";
            league.textContent = item.league.name;

            const teams = document.createElement("h3");
            teams.className = "gold";
            teams.textContent =
                `${item.teams.home.name} VS ${item.teams.away.name}`;

            const time = document.createElement("p");
            time.className = "info";
            time.textContent = new Date(item.fixture.date)
                .toLocaleTimeString("fr-FR", {
                    timeZone: "Africa/Ouagadougou",
                    hour: "2-digit",
                    minute: "2-digit"
                });

            card.append(league, teams, time);
            matchContainer.appendChild(card);
        });

    } catch (error) {
        matchContainer.textContent =
            error.message + " Vérifie la connexion au serveur.";
    }
}
