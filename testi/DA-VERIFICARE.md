# Testi: cosa ricontrollare prima del lancio

I testi dei 50 siti (IT, EN, FR, DE) sono BOZZE scritte da un'intelligenza artificiale, in gran parte senza verifica su fonti esterne. Vanno riletti da una guida turistica o da uno storico locale e confrontati con fonti (Comune, Soprintendenza, siti dei musei, UNESCO). Le leggende sono presentate come tali ("si racconta che…"); dove non c'era una leggenda ben attestata il secondo paragrafo è una "curiosità" storica.

Punti segnalati come meno sicuri durante la scrittura:

- **Cattedrale, Cappella Palatina**: date di consacrazione/incoronazione (1140, 1130), iscrizioni trilingui, parti originali normanne.
- **Martorana**: anno 1433 e Eloisa Martorana; la frutta di marzapane è tradizione, non documento.
- **San Cataldo**: data intorno al 1154, decorazione interna incompiuta, uso ottocentesco come ufficio postale.
- **San Giovanni degli Eremiti**: origine da Gregorio Magno e sala della moschea (tradizioni); restauro ottocentesco.
- **Zisa**: sistema di raffrescamento (ipotesi), etimologia "splendida", inizio lavori 1165.
- **Ponte dell'Ammiraglio**: anno 1131, deviazione dell'Oreto, battaglia del 27 maggio 1860.
- **Quattro Canti, Piazza Pretoria**: inizio lavori 1609; acquisto della fontana nel 1573; leggenda delle suore di Santa Caterina; origine del nome.
- **Teatro Massimo**: date 1875, 1891, 16 maggio 1897; chiusura 1974-1997; leoni di Mario Rutelli. Il titolo nel CSV è stato corretto in "Teatro Massimo Vittorio Emanuele".
- **Politeama**: carro di bronzo, etimologia di "Politeama".
- **Ballarò, Capo, Vucciria, Lattarini**: etimologie (Bahlara, caput, boucherie, attarin) sono ipotesi; Guttuso 1974; leggenda dei Beati Paoli.
- **Spasimo**: fondatore e data 1509; storia del dipinto di Raffaello (oggi al Prado).
- **Palazzo Abatellis**: ruolo di Francesco Abatellis, danni del 1943, allestimento di Carlo Scarpa.
- **Cala, Foro Italico**: leggenda delle catene spezzate; data del Festino; reliquie del 1624.
- **Catacombe dei Cappuccini**: 1599, suddivisione dei corridoi, Rosalia Lombardo (1920) e Alfredo Salafia; "una delle ultime sepolture".
- **Santa Rosalia**: statua di Gregorio Tedeschi, pellegrinaggio 3-4 settembre, visita di Goethe 1787.
- **Mondello**: società belga della bonifica, tram, anno 1913 dello stabilimento.
- **San Domenico, Magione, Sant'Agostino, Mirto, Steri, San Lorenzo, Santa Cita, Casa Professa**: facciate e date settecentesche, passaggio ai cavalieri teutonici 1197, stucchi di Serpotta (1711, 1686, 1718, 1699-1706), soffitto dello Steri 1377-1380, furto della Natività di Caravaggio nell'ottobre 1969, arrivo dei gesuiti 1549.
- **Valguarnera Gangi**: date dei lavori (Settecento, fino al 1792); film Il Gattopardo 1963.
- **Porta Nuova, Porta Felice, Piazza Marina, Orto Botanico**: date da una sola fonte (1583, 1667, 1669; ficus piantato nel 1864; Orto fondato nel 1779).
- **Villa Giulia, Malfitano, Villino Florio, Favorita, Lebbrosi, Utveggio, Pasqualino, Catena, Teatini, Capo Gallo**: anni di costruzione, progettisti, committenti; riconoscimento UNESCO del museo dei pupi; orari e sedi dei musei possono cambiare.

Come modificare un testo: dall'admin (Monumenti e QR, Testi e dati) per una correzione singola; oppure modificando i file `testi/*.txt` e lanciando `npm run sync-testi`, poi pubblicando. Il pulsante "Carica i testi" non sovrascrive mai un testo già presente nel database.
