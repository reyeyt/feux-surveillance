// simulate_mcu.js
const mqtt = require('mqtt');
const client = mqtt.connect('mqtt://test.mosquitto.org:1883');

// Définition des types de feux et de leurs états possibles
const typeStates = {
  "Tricolore": {
    count: 3, // états 0, 1, 2
    states: {
      0: { label: "Rouge", color: "#ef4444" },
      1: { label: "Orange", color: "#f59e0b" },
      2: { label: "Vert", color: "#22c55e" }
    }
  },
  "Piéton + Cligno": {
    count: 4, // états 0, 1, 2, 3
    states: {
      0: { label: "Éteint", color: "#6b7280" },
      1: { label: "Jaune Cligno", color: "#fbbf24" },
      2: { label: "Rouge Piéton", color: "#ef4444" },
      3: { label: "Vert Piéton", color: "#22c55e" }
    }
  },
  "Transport en commun": {
    count: 2, // états 0, 1
    states: {
      0: { label: "Stop", color: "#ef4444" },
      1: { label: "Go", color: "#22c55e" }
    }
  }
};

// Quelques listes pour générer des données aléatoires
const companies = ["CompanyA", "CompanyB", "CompanyC"];
const paysList = ["FR", "BE", "DE"];
const tensions = ["12V DC", "24V DC", "230V AC"];
const modes = ["Fixe", "Clignotant", "Alterné"];
const optiques = ["OK", "NOK"];

// Fonctions utilitaires
function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function getRandomChoice(arr) {
  return arr[getRandomInt(0, arr.length - 1)];
}

// Fonction qui génère un tableau de feux aléatoires
function generateRandomFeux(count) {
  const feux = [];
  const centerLat = 44.8378;
  const centerLng = -0.5792;
  for (let i = 0; i < count; i++) {
    // Choix aléatoire du type
    const type = getRandomChoice(Object.keys(typeStates));
    const stateCount = typeStates[type].count;
    const feu = {
      id: "FeuRand" + String(i + 1).padStart(3, "0"),
      nom: "Feu Aléatoire #" + (i + 1),
      type: type,
      owner: getRandomChoice(companies),
      pays: getRandomChoice(paysList),
      tension_service: getRandomChoice(tensions),
      tension_alim: getRandomChoice(tensions),
      etat_courant: getRandomInt(0, stateCount - 1),
      cycles_count: getRandomInt(0, 100),
      // Coordonnées générées autour d'un centre
      latitude: centerLat + (Math.random() - 0.5) * 0.1,
      longitude: centerLng + (Math.random() - 0.5) * 0.1,
      serie: "C" + getRandomInt(1000, 9999),
      tempsFonction: getRandomInt(50, 200) + "h",
      autonomie: getRandomInt(5, 30) + "h",
      mode: getRandomChoice(modes),
      tableCycle: getRandomInt(1, 2),
      optiqueHaut: getRandomChoice(optiques),
      optiqueCentre: getRandomChoice(optiques),
      optiqueBas: getRandomChoice(optiques),
      posPhysique: "Emplacement " + (i + 1),
      radio: Math.random() < 0.5,
      bluetooth: Math.random() < 0.5,
      // Dernier changement initialisé à l'instant
      dernier_changement: new Date().toISOString()
    };
    feux.push(feu);
  }
  return feux;
}

// Génération de 10 feux aléatoires
let feux = generateRandomFeux(10);

// Lorsque le client MQTT est connecté
client.on('connect', () => {
  console.log("Simulation: Connecté au broker MQTT");
  // Envoi des mises à jour toutes les 5 secondes
  setInterval(() => {
    feux.forEach(feu => {
      // Passage à l'état suivant de manière cyclique
      const stateCount = typeStates[feu.type].count;
      feu.etat_courant = (feu.etat_courant + 1) % stateCount;
      feu.cycles_count++;
      feu.dernier_changement = new Date().toISOString();
      
      // Préparer et envoyer le message MQTT
      const payload = JSON.stringify(feu);
      client.publish("feux/etat", payload, err => {
        if (err) {
          console.error("Erreur de publication MQTT :", err);
        } else {
          console.log(`Message publié pour ${feu.id} : ${payload}`);
        }
      });
    });
  }, 5000);
});

// Gestion des erreurs MQTT
client.on('error', (error) => {
  console.error("Erreur MQTT :", error);
});
