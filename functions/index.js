const functions = require("firebase-functions");
const { firestore } = require("firebase-admin");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
admin.initializeApp();
const logging = require("firebase-functions/logger/compat");
const FieldValue = require('firebase-admin').firestore.FieldValue;
const https = require('https');
const { v4: uuidv4 } = require("uuid");

exports.stockNotification = onSchedule("*/5 14-21 * * 1-5", async (event) => {
  console.log("New output: \n\n\n\n\n");

  let docDefaults = admin.firestore().collection("settings").doc("defaults");
  let defaultsSnap = await docDefaults.get();
  const { marketOpened } = defaultsSnap.data();
  console.log("marketOpened: ", marketOpened);
  var isTheStockMarketOpen = false;

  const response = await fetch("https://financialmodelingprep.com/api/v3/is-the-market-open?exchange=US&apikey=w5aSHK4lDmUdz6wSbKtSlcCgL1ckI12Q");
  if (response.ok) {
    const data = await response.text();
    let marketData = JSON.parse(data);
    isTheStockMarketOpen = marketData.isTheStockMarketOpen;
    console.log("isTheStockMarketOpen: ", isTheStockMarketOpen);
  } else {
    throw new Error('Request failed: ' + response.statusText);
    return 1;
  }

  if ((marketOpened == false) && (isTheStockMarketOpen == false)) {
    let res = await docDefaults.update({marketOpened: false});
    console.log("Market Closed!");
    return 1
  }

  if ((marketOpened == false) && (isTheStockMarketOpen == true)) {
    let res = await docDefaults.update({marketOpened: true});
    console.log("market opened!");
  }

  if ((marketOpened == true) && (isTheStockMarketOpen == false)) {
    let res = await docDefaults.update({marketOpened: false});
    console.log("Market is closing!");
  }

  var ids = []
  const contactRef = admin.firestore().collection('users');
  const snapshot = await contactRef.get();
  snapshot.forEach(doc => {
    ids.push(doc.id);
  });

  var myObjs = []
  for (let i = 0; i < ids.length; i++) {
    console.log("id : ", ids[i]);
    const docRef = admin.firestore().collection('users').doc(ids[i]);
    const docSnap = await docRef.get();
    const { notifications, fcm, activityToken } = docSnap.data();
    if (notifications === undefined) {
      continue;
    };

    if (fcm.length > 0 && notifications.length > 0) {
      var myObj = {
        "id": ids[i],
        "fcm": fcm,
        "activityToken": activityToken,
        "notificationDatas": null,
        "newStrings": [],
      };
      var notificationDatas = [];
      for (let j = 0; j < notifications.length; j++) {
        const myArray = notifications[j].split(',');
        if (myArray.length != 8) {
          continue;
        }

        let notificationData = {
          "symbol": myArray[0],
          "notificationType": myArray[1],
          "notificationFrequency": myArray[2],
          "action": myArray[3],
          "amount": myArray[4],
          "price": myArray[5],
          "volume": myArray[6],
          "change": myArray[7],
         };
         notificationDatas.push(notificationData);
      }
      myObj.notificationDatas = notificationDatas;
    }
    if (fcm.length > 0 && notifications.length > 0) {
      myObjs.push(myObj);
    }
  }

  if (myObjs.length > 0) {
    var symbols = new Set();
    for (let i = 0; i < myObjs.length; i++) {
      for (let j = 0; j < myObjs[i].notificationDatas.length; j++) {
        symbols.add(myObjs[i].notificationDatas[j].symbol);
      };
    };

    let array = Array.from(symbols);
    let string = array.join(",");
    console.log("symbols: ", string);

    const options = {
      hostname: 'financialmodelingprep.com',
      port: 443,
      path: 'https://financialmodelingprep.com/api/v3/quote-order/' + string + '?apikey=w5aSHK4lDmUdz6wSbKtSlcCgL1ckI12Q',
      method: 'GET'
    };

    const req = https.request(options, (res) => {
      res.on('data', (d) => {
        let financialData = JSON.parse(d);
        console.log("financialData: ", financialData);
        for (let i = 0; i < financialData.length; i++) {
          let symbol = financialData[i].symbol;
          for (let j = 0; j < myObjs.length; j++) {
            for (let k = 0; k < myObjs[j].notificationDatas.length; k++) {
              if (myObjs[j].notificationDatas[k].symbol == symbol) {
                var stringOld = myObjs[j].notificationDatas[k].symbol + "," + myObjs[j].notificationDatas[k].notificationType + "," + myObjs[j].notificationDatas[k].notificationFrequency + "," + myObjs[j].notificationDatas[k].action + "," + myObjs[j].notificationDatas[k].amount;
                let stringNew = stringOld + "," + financialData[i].price + "," + financialData[i].volume + "," + financialData[i].change;
                stringOld += "," + notificationDatas[k].price + "," + notificationDatas[k].volume + "," + notificationDatas[k].change;
                myObjs[j].notificationDatas[k].price = financialData[i].price;
                myObjs[j].notificationDatas[k].volume = financialData[i].volume;
                myObjs[j].notificationDatas[k].change = financialData[i].change;
                console.log("stringNew: ", stringNew);
                myObjs[j].newStrings.push(stringNew);
              }
            }
          }
        }
        for (let j = 0; j < myObjs.length; j++) {
          if (myObjs[j].newStrings.length > 0) {
            console.log("myObjs[j].newStrings: ", myObjs[j].newStrings);
            updateNotificationsArray(myObjs[j].id, myObjs[j].newStrings);
            var payload = []
            for (let i = 0; i < myObjs[j].newStrings.length; i++) {
              let myArray = myObjs[j].newStrings[i].split(',');
              let item = {
                           id: uuidv4(),
                           symbol: myArray[0],
                           marketPrice: parseFloat(myArray[5]),
                           change: parseFloat(myArray[7]),
                         };
              payload.push(item)
            }
            console.log("payload: ", payload);
            sendActivityNotification(myObjs[j].fcm, myObjs[j].activityToken, payload);
          }
        }
      });
    });

    req.on('error', (error) => {
      console.log("error: ", error);
    });

    req.end()
  }

  return 1;
});

function sendSilentNotification(fcm) {

  const payload = {
    token: fcm,
    data: {
      title: 'Start Activity',
      body: "",
    },
  };

  const options = {
    content_available: true
  }

  admin.messaging().send(payload, false, options).then((response) => {
    console.log("Successfully sent silent notification: ", response);
    return {success: true};
  }).catch((error) => {
    console.log("Failed to send silent notification:", error.code);
    return {error: error.code};
  });

}

function sendActivityNotification(fcm, activityToken, data) {
  const secondsSinceEpoch = Math.floor(Date.now() / 1000);
  var message = {};
  console.log("activityAction: update");
  message = {
    token: fcm,
    apns: {
      "live_activity_token": activityToken,
      "headers": {
        "apns-priority": '10',
      },
      "payload": {
        "aps": {
          "timestamp": secondsSinceEpoch,
          "event": "update",
          "content-state": {
             "items": data,
          },
          "alert": {
            "title": 'test title',
            "body": 'test body',
         }
        }
      }
    }
  };
  console.log("message: ", message);
  admin.messaging().send(message).then((response) => {
    console.log("Successfully sent message:", response);
    return {success: true};
  }).catch((error) => {
  console.log("Failed to send message:", error.code);
    return {error: error.code};
  });

}

async function removeItemFromArray(id, itemToRemove) {
  try {
    await admin.firestore().collection('users').doc(id).update({"notifications": FieldValue.arrayRemove(itemToRemove)});
    console.log('Item removed successfully: ', itemToRemove);
  } catch (error) {
    console.error('Error updating document:', error);
  }
}

async function addItemToArray(id, itemToAdd) {
  try {
    await admin.firestore().collection('users').doc(id).update({"notifications": FieldValue.arrayUnion(itemToAdd)});
    console.log("Item added successfully: ", itemToAdd);
  } catch (error) {
    console.error('Error updating document:', error);
  }
}

async function removeAddItemToArray(id, itemToRemove, itemToAdd) {
  try {
    await admin.firestore().collection('users').doc(id).update({"notifications": FieldValue.arrayRemove(itemToRemove)});
    console.log('Item removed successfully: ', itemToRemove);
    try {
      await admin.firestore().collection('users').doc(id).update({"notifications": FieldValue.arrayUnion(itemToAdd)});
      console.log("Item added successfully: ", itemToAdd);
    } catch (error) {
      console.error('Error updating document:', error);
    }
  } catch (error) {
    console.error('Error updating document:', error);
  }
}

async function updateNotificationsArray(id, array) {
  const res = await admin.firestore().collection('users').doc(id).update({notifications: FieldValue.delete()});
  const res2 = await admin.firestore().collection('users').doc(id).update({notifications: array});
}

function oldSendNotification() {

/*
        for (let i = 0; i < myObjs.length; i++) {
          console.log("id: ", myObjs[i].id);
          var message = "";
          var stocks = "";
          for (let j = 0; j < myObjs[i].notificationDatas.length; j++) {
            console.log("notificationDatas: ", myObjs[i].notificationDatas[j]);
            if (myObjs[i].notificationDatas[j].notificationType == 'Price') {
              var amount = parseFloat(myObjs[i].notificationDatas[j].amount);
              var fixedAmount = "$" + parseFloat(myObjs[i].notificationDatas[j].amount).toFixed(2);
              var price = myObjs[i].notificationDatas[j].price;
              var fixedPrice = "$" + myObjs[i].notificationDatas[j].price.toFixed(2);
              switch(myObjs[i].notificationDatas[j].action) {
                case '=':
                  if (price == amount) {
                    myObjs[i].notificationDatas[j].sendMessage = true;
                    message += myObjs[i].notificationDatas[j].symbol + " is equal to " + fixedAmount + " at " + fixedPrice + "\n";
                    stocks += myObjs[i].notificationDatas[j].symbol + " ";
                  }
                  break;
                case '>':
                  if (price > amount) {
                    myObjs[i].notificationDatas[j].sendMessage = true;
                    message += myObjs[i].notificationDatas[j].symbol + " is above " + fixedAmount + " at " + fixedPrice + "\n";
                    stocks += myObjs[i].notificationDatas[j].symbol + " ";
                  }
                  break;
                case '>=':
                  if (price >= amount) {
                    myObjs[i].notificationDatas[j].sendMessage = true;
                    message += myObjs[i].notificationDatas[j].symbol + " is above or equal to " + fixedAmount + " at " + fixedPrice + "\n";
                    stocks += myObjs[i].notificationDatas[j].symbol + " ";
                  }
                  break;
                case '<':
                  if (price < amount) {
                    myObjs[i].notificationDatas[j].sendMessage = true;
                    message += myObjs[i].notificationDatas[j].symbol + " is less than " + fixedAmount + " at " + fixedPrice + "\n";
                    stocks += myObjs[i].notificationDatas[j].symbol + " ";
                  }
                  break;
                case '<=':
                  if (price <= amount) {
                    myObjs[i].notificationDatas[j].sendMessage = true;
                    message += myObjs[i].notificationDatas[j].symbol + " is less than or equal to " + fixedAmount + " at " + fixedPrice + "\n";
                    stocks += myObjs[i].notificationDatas[j].symbol + " ";
                  }
                  break;
                default:
                  console.log("action: default");
              }
            }
          };
          if (stocks.length > 0) {
            var title = "Alert for " + stocks;
            console.log(title);
            console.log(message);
            console.log("fcm: ", myObjs[i].fcm);
            const payload = {
              token: myObjs[i].fcm,
              data: {
                title: 'set badge',
                body: 'test',
                event_id: myObjs[i].fcm,
              },
              notification: {
                title: title,
                body: message,
              },
            };
            admin.messaging().send(payload).then((response) => {
              console.log("Successfully sent message:", response);
              return {success: true};
            }).catch((error) => {
              console.log("Failed to send message:", error.code);
              return {error: error.code};
            });
          };
        };
*/


}

//  }
/*
 else if (activityAction == "end") {
    console.log("activityAction: end");
    message = {
      token: fcm,
      apns: {
        "live_activity_token": activityToken,
        "headers": {
          "apns-priority": '10',
        },
        "payload": {
          "aps": {
            "timestamp": secondsSinceEpoch,
            "event": "end",
            "content-state": {
               "items": data,
            },
            "alert": {
              "title": 'test title',
              "body": 'test body',
            }
          }
        }
      }
    };
  } else if (activityAction == "start") {
    console.log("activityAction: start");
    let item = {
      id: uuidv4(),
      symbol: "Start Activity",
      marketPrice: 0,
      change: 0,
    };

    var items = [];
    items.push(item);
    message = {
      token: fcm,
      apns: {
        "live_activity_token": activityToken,
        "headers": {
          "apns-priority": '10',
        },
        "payload": {
          "aps": {
            "timestamp": secondsSinceEpoch,
            "event": "start",
            "content-state": {
               "items": items,
            },
            "attributes-type": "StockActivityAttributes",
            "attributes": {
              "items": items,
            },
            "alert": {
              "title": 'test title',
              "body": 'test body',
              "sound": "default"
            }
          }
        }
      }
    };
*/