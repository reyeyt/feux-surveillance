// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mqtt = require('mqtt');
const mysql = require('mysql');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Pour parser le JSON
app.use(express.json());

// Configuration de la connexion MySQL
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '2003',
  database: 'prajot'
});

db.connect((err) => {
  if (err) {
    console.error("Erreur DB :", err);
    process.exit(1);
  }
  console.log("Connecté à MySQL");
});

// Connexion au broker MQTT
const mqttClient = mqtt.connect('mqtt://localhost');

mqttClient.on('connect', () => {
  console.log("Client MQTT connecté");
  mqttClient.subscribe('feux/etat', (err) => {
    if (err) {
      console.error("Erreur d'abonnement :", err);
    } else {
      console.log('Abonné au topic "feux/etat"');
    }
  });
});

mqttClient.on('message', (topic, message) => {
  let payload;
  try {
    payload = JSON.parse(message.toString());
  } catch (error) {
    console.error("Erreur de parsing JSON :", error);
    return;
  }
  
  // On récupère les coordonnées depuis payload.localisation si défini, sinon payload.latitude/longitude
  const lat = payload.localisation && payload.localisation.lat ? payload.localisation.lat : payload.latitude;
  const lng = payload.localisation && payload.localisation.lng ? payload.localisation.lng : payload.longitude;
  
  // Vérifier si le feu existe déjà dans la table "FEUX"
  const selectSql = "SELECT ID FROM FEUX WHERE ID = ?";
  db.query(selectSql, [payload.id], (err, results) => {
    if (err) {
      console.error("Erreur lors de la récupération du feu :", err);
      return;
    }
    if (results.length === 0) {
      // Le feu n'existe pas, insertion d'un nouveau record
      console.log("Feu non trouvé, insertion d'un nouveau record pour :", payload.id);
      const insertSql = `
        INSERT INTO FEUX 
          (ID, Pays, Tension_service, Tension_alimentation, Luminosité, 
           Temps, Autonomie, Mode, Num_cycle, Table_cycle, 
           Etat_optique_haut, Etat_optique_bas, Etat_optique_central, 
           Position_Géo, Position_Physique, Radio, Bluetooth, IDE)
        VALUES 
          (?, ?, ?, ?, 100, 
           ?, ?, ?, ?, ?, 
           ?, ?, ?, 
           ?, ?, ?, ?, ?)
      `;
      db.query(insertSql, [
        payload.id,
        payload.pays,
        payload.tension_service,
        payload.tension_alim,
        payload.tempsFonction,
        payload.autonomie,
        payload.mode,
        payload.cycles_count.toString(),
        payload.tableCycle.toString(),
        payload.optiqueHaut,
        payload.optiqueBas,
        payload.optiqueCentre,
        `${lat},${lng}`,
        payload.posPhysique,
        payload.radio ? 'oui' : 'non',
        payload.bluetooth ? 'oui' : 'non',
        payload.owner
      ], (err, insertResult) => {
        if (err) {
          console.error("Erreur d'insertion dans FEUX :", err);
          return;
        }
        console.log("Insertion réussie pour", payload.id);
        
        // Insérer dans l'historique pour un nouveau feu
        const insertHistorique = `
          INSERT INTO FEUX_HISTORIQUE 
            (feu_id, etat_precedent, etat_courant, date_changement)
          VALUES 
            (?, ?, ?, NOW())
        `;
        
        db.query(insertHistorique, [
          payload.id,
          null, // Premier état, pas d'état précédent
          payload.etat_courant
        ], (err) => {
          if (err) {
            console.error("Erreur d'insertion dans l'historique (nouveau feu) :", err);
          } else {
            console.log(`Premier état enregistré pour ${payload.id}: null -> ${payload.etat_courant}`);
          }
        });
      });
    } else {
      // Le feu existe, mise à jour de ses propriétés
      const updateSql = `
        UPDATE FEUX 
        SET Pays = ?, 
            Tension_service = ?, 
            Tension_alimentation = ?, 
            Temps = ?, 
            Autonomie = ?, 
            Mode = ?, 
            Num_cycle = ?, 
            Table_cycle = ?, 
            Etat_optique_haut = ?, 
            Etat_optique_bas = ?, 
            Etat_optique_central = ?, 
            Position_Géo = ?, 
            Position_Physique = ?, 
            Radio = ?, 
            Bluetooth = ?, 
            IDE = ? 
        WHERE ID = ?
      `;
      db.query(updateSql, [
        payload.pays,
        payload.tension_service,
        payload.tension_alim,
        payload.tempsFonction,
        payload.autonomie,
        payload.mode,
        payload.cycles_count.toString(),
        payload.tableCycle.toString(),
        payload.optiqueHaut,
        payload.optiqueBas,
        payload.optiqueCentre,
        `${lat},${lng}`,
        payload.posPhysique,
        payload.radio ? 'oui' : 'non',
        payload.bluetooth ? 'oui' : 'non',
        payload.owner,
        payload.id
      ], (err, updateResult) => {
        if (err) {
          console.error("Erreur de mise à jour DB :", err);
          return;
        }
        console.log(`Mise à jour effectuée pour ${payload.id}`);
        
        // Insérer dans l'historique après mise à jour
        const insertHistorique = `
          INSERT INTO FEUX_HISTORIQUE 
            (feu_id, etat_precedent, etat_courant, date_changement)
          VALUES 
            (?, ?, ?, NOW())
        `;
        
        // D'abord récupérer l'état précédent le plus récent
        db.query("SELECT etat_courant FROM FEUX_HISTORIQUE WHERE feu_id = ? ORDER BY date_changement DESC LIMIT 1", 
          [payload.id], (err, results) => {
            // État précédent ou null si c'est la première entrée
            const etatPrecedent = results && results.length > 0 ? results[0].etat_courant : null;
            
            // Puis insérer la nouvelle entrée dans l'historique seulement si l'état a changé
            if (etatPrecedent !== payload.etat_courant) {
              db.query(insertHistorique, [
                payload.id,
                etatPrecedent,
                payload.etat_courant
              ], (err) => {
                if (err) {
                  console.error("Erreur d'insertion dans l'historique :", err);
                } else {
                  console.log(`Historique enregistré pour ${payload.id}: ${etatPrecedent} -> ${payload.etat_courant}`);
                }
              });
            }
        });
        
        // Notifier les clients via Socket.IO
        const selectUpdatedSql = "SELECT * FROM FEUX WHERE ID = ?";
        db.query(selectUpdatedSql, [payload.id], (err, rows) => {
          if (err) {
            console.error("Erreur lors de la récupération du feu mis à jour :", err);
            return;
          }
          if (rows.length > 0) {
            // Ajouter des propriétés supplémentaires pour compatibilité
            const feuData = rows[0];
            feuData.etat_courant = payload.etat_courant;
            feuData.nom = payload.nom;
            feuData.type = payload.type;
            feuData.dernier_changement = payload.dernier_changement;
            feuData.latitude = lat;
            feuData.longitude = lng;
            
            io.emit('update_feu', feuData);
          }
        });
      });
    }
  });
});

app.get('/api/feux', (req, res) => {
    // Pour les besoins du débogage, affichons l'ensemble des feux dans la table FEUX_HISTORIQUE
    db.query("SELECT DISTINCT feu_id FROM FEUX_HISTORIQUE", (err, rows) => {
      if (err) {
        console.error("Erreur lors de la récupération des feux:", err);
        return res.status(500).json({ error: "Erreur serveur" });
      }
      
      // Transformez les résultats pour qu'ils aient le format attendu par le client
      const feux = rows.map(row => ({
        ID: row.feu_id,    // C'est cette valeur qui sera utilisée comme option.value
        nom: `Feu ${row.feu_id}`
      }));
      
      console.log("Feux disponibles:", feux);
      res.json(feux);
    });
  });

app.get('/api/historique', (req, res) => {
  // Ici, on récupère feu_id au lieu de feuId pour correspondre avec la requête du client
  const { feu_id, dateDebut, dateFin, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  
  let sql = "SELECT h.*, f.ID as feu_nom FROM FEUX_HISTORIQUE h LEFT JOIN FEUX f ON h.feu_id COLLATE utf8mb4_general_ci = f.ID WHERE 1=1";
  let countSql = "SELECT COUNT(*) as total FROM FEUX_HISTORIQUE h WHERE 1=1";
  const params = [];
  
  // Ajout des filtres si spécifiés
  if (feu_id) {
    sql += " AND h.feu_id = ?";
    countSql += " AND h.feu_id = ?";
    params.push(feu_id);
  }
  
  if (dateDebut) {
    sql += " AND h.date_changement >= ?";
    countSql += " AND h.date_changement >= ?";
    params.push(dateDebut + " 00:00:00");
  }
  
  if (dateFin) {
    sql += " AND h.date_changement <= ?";
    countSql += " AND h.date_changement <= ?";
    params.push(dateFin + " 23:59:59");
  }
  
  // Ajout de l'ordre et de la pagination
  sql += " ORDER BY h.date_changement DESC LIMIT ? OFFSET ?";
  const pageParams = [...params, parseInt(limit), offset];
  
  // Exécuter les requêtes
  db.query(countSql, params, (err, countResult) => {
    if (err) {
      console.error("Erreur lors du comptage de l'historique:", err);
      return res.status(500).json({ error: "Erreur serveur" });
    }
    
    db.query(sql, pageParams, (err, rows) => {
      if (err) {
        console.error("Erreur lors de la récupération de l'historique:", err);
        return res.status(500).json({ error: "Erreur serveur" });
      }
      
      res.json({
        historique: rows,
        total: countResult[0].total,
        page: parseInt(page),
        limit: parseInt(limit)
      });
    });
  });
});

// Socket.IO : Envoi des données initiales aux clients connectés
io.on('connection', (socket) => {
  console.log("Un client web est connecté");
  db.query("SELECT * FROM FEUX", (err, rows) => {
    if (err) {
      console.error("Erreur lors de la récupération initiale :", err);
      return;
    }
    // Ajouter des propriétés par défaut pour les champs manquants
    const feuxData = rows.map(feu => {
      const posGeo = feu.Position_Géo ? feu.Position_Géo.split(',') : [44.8378, -0.5792];
      return {
        ...feu,
        etat_courant: 0, // État par défaut
        nom: `Feu ${feu.ID}`,
        type: "Tricolore",
        dernier_changement: new Date().toISOString(),
        latitude: parseFloat(posGeo[0]),
        longitude: parseFloat(posGeo[1])
      };
    });
    socket.emit('initial_data', feuxData);
  });
});

// Servir les fichiers statiques depuis le dossier "public"
app.use(express.static('public'));

server.listen(3000, () => {
  console.log("Serveur lancé sur le port 3000");
});