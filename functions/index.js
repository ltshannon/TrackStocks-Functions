const functions = require("firebase-functions");
const { firestore } = require("firebase-admin");
const admin = require("firebase-admin");
admin.initializeApp();
const logging = require("firebase-functions/logger/compat");
const FieldValue = require('firebase-admin').firestore.FieldValue;
const https = require('https');

exports.test = functions.https.onCall(async (data, context) => {

//  if (!context?.auth) {
//    console.log("Authentication Required!");
//    return { message: "Authentication Required!", code: 401 };
//  }

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
    const { notifications, fcm } = docSnap.data()
    if (notifications === undefined) {
      continue;
    };
    console.log("fcm: ", fcm);
    console.log("notifications: ", notifications);
    if (fcm.length > 0 && notifications.length > 0) {
      var myObj = {
        "id": ids[i],
        "fcm": fcm,
        "notificationDatas": null,
      }
      var notificationDatas = []
      for (let j = 0; j < notifications.length; j++) {
//        console.log("notification: ", notifications[j]);
        const myArray = notifications[j].split(',');
        if (myArray.length != 4) {
          continue;
        }

        let notificationData = {
          "symbol": myArray[0],
          "notificationType": myArray[1],
          "action": myArray[2],
          "amount": myArray[3],
          "price": 0,
          "volume": 0,
         };
         notificationDatas.push(notificationData);
      }
      myObj.notificationDatas = notificationDatas
    }
//    console.log("myObj.notificationDatas: ", myObj.notificationDatas)
    myObjs.push(myObj);
  }

//  console.log("myObjs: ", myObjs);

  var symbols = new Set();
  for (let i = 0; i < myObjs.length; i++) {
    console.log("id: ", myObjs[i].id);
    for (let j = 0; j < myObjs[i].notificationDatas.length; j++) {
//      console.log("notificationDatas: ", myObjs[i].notificationDatas[j].symbol);
      symbols.add(myObjs[i].notificationDatas[j].symbol);
    };
  };

  let array = Array.from(symbols);
  let string = array.join(",");
  console.log("symbols: ", string);

  const options = {
    hostname: 'financialmodelingprep.com',
    port: 443,
    path: 'https://financialmodelingprep.com/api/v3/quote-short/' + string + '?apikey=w5aSHK4lDmUdz6wSbKtSlcCgL1ckI12Q',
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
              myObjs[j].notificationDatas[k].price = financialData[i].price;
              myObjs[j].notificationDatas[k].volume = financialData[i].volume;
            }
          }
        }
      }
      for (let i = 0; i < myObjs.length; i++) {
        console.log("id: ", myObjs[i].id);
        for (let j = 0; j < myObjs[i].notificationDatas.length; j++) {
          console.log("notificationDatas: ", myObjs[i].notificationDatas[j]);
        };
      };
    });
  });
  req.on('error', (error) => {
    console.log("error: ", error);
  });

  req.end()

 
/*
      const payload = {
        token: fcm,
        data: {
          title: 'set badge',
          body: 'test',
          event_id: fcm,
        },
        notification: {
          title: 'title',
          body: 'this is a message',
        },
      };
      admin.messaging().send(payload).then((response) => {
        console.log("Successfully sent message:", response);
        return {success: true};
      }).catch((error) => {
        console.log("Failed to send message:", error.code);
        return {error: error.code};
      });
*/


  return 1;
});