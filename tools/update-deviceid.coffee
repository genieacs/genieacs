# This script will generate _deviceId struct for all devices in DB.
# To be used in migrating existing data to the recent update which introduced _deviceId object.
config = require '../config'
mongodb = require 'mongodb'

dbserver = new mongodb.Server(config.MONGODB_SOCKET, 0, {auto_reconnect: true})
db = new mongodb.Db(config.DATABASE_NAME, dbserver, {native_parser: true, safe: true})

query = {}

projection = {
  _id : true,
  'InternetGatewayDevice.DeviceInfo' : true
}

db.open((err, db) ->
  db.collection('devices', (err, collection) ->
    cur = collection.find(query)
    cur.each((err, doc) ->
      if not doc?
        db.close()
        return
      serialNumber = doc['InternetGatewayDevice']['DeviceInfo']['SerialNumber']['_value']
      oui = doc['InternetGatewayDevice']['DeviceInfo']['ManufacturerOUI']['_value']
      manufacturer = doc['InternetGatewayDevice']['DeviceInfo']['Manufacturer']['_value']
      productClass = doc['InternetGatewayDevice']['DeviceInfo']['ProductClass']['_value']
      id = doc['_id']
      collection.update({_id : id}, {$set : {
        '_deviceId._Manufacturer' : manufacturer,
        '_deviceId._OUI' : oui,
        '_deviceId._ProductClass' : productClass,
        '_deviceId._SerialNumber' : serialNumber
      }}, () ->
      )
    )
  )
)
