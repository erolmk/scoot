// RideOn smart-lock prototype (ESP32, Arduino core).
// The phone writes "UNLOCK|<vehicle>|<expiry-unix>|<hex hmac>" received from the RideOn server.
// The lock recomputes HMAC-SHA256 with its own copy of the secret, so a forged or edited key fails.
// Hardware: ESP32 dev board, SG90 servo (or 5 V solenoid via MOSFET) on SERVO_PIN, latch switch on LATCH_PIN.
#include <BLEDevice.h>
#include <BLEServer.h>
#include <ESP32Servo.h>
#include "mbedtls/md.h"

#define SVC_UUID "7a0e0001-6d1b-4c1f-9b1e-5243554f4e01"
#define CHR_UUID "7a0e0002-6d1b-4c1f-9b1e-5243554f4e01"
const char *VEHICLE = "v1";                 // this lock's vehicle id
const char *SECRET = "set-me-from-RIDEON_LOCK_SECRET";
const int SERVO_PIN = 13, LATCH_PIN = 14;    // latch switch closes to GND when the bolt is home
const int OPEN_DEG = 90, SHUT_DEG = 0;       // tune on the real bolt

Servo bolt;
BLECharacteristic *chr;
uint32_t lastExpiry = 0;                     // ponytail: no real-time clock; replay of an older key is blocked, add RTC/NTP time check for production

String hmacHex(const String &msg) {
  uint8_t out[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
  mbedtls_md_hmac_starts(&ctx, (const uint8_t *)SECRET, strlen(SECRET));
  mbedtls_md_hmac_update(&ctx, (const uint8_t *)msg.c_str(), msg.length());
  mbedtls_md_hmac_finish(&ctx, out);
  mbedtls_md_free(&ctx);
  char hex[65];
  for (int i = 0; i < 32; i++) sprintf(hex + i * 2, "%02x", out[i]);
  return String(hex);
}

void report(const char *s) { chr->setValue(s); chr->notify(); Serial.println(s); }

class Cmd : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    String v = String(c->getValue().c_str());
    int cut = v.lastIndexOf('|');
    if (cut < 0) return report("ERR format");
    String msg = v.substring(0, cut), sig = v.substring(cut + 1);
    if (!msg.startsWith(String("UNLOCK|") + VEHICLE + "|")) return report("ERR vehicle");
    if (hmacHex(msg) != sig) return report("ERR signature");
    uint32_t exp = msg.substring(msg.lastIndexOf('|') + 1).toInt();
    if (exp < lastExpiry) return report("ERR old key");
    lastExpiry = exp;
    bolt.write(OPEN_DEG);
    report("OPEN");
  }
};

void setup() {
  Serial.begin(115200);
  pinMode(LATCH_PIN, INPUT_PULLUP);
  bolt.attach(SERVO_PIN);
  bolt.write(SHUT_DEG);
  BLEDevice::init((String("RideOn-") + VEHICLE).c_str());
  BLEServer *srv = BLEDevice::createServer();
  BLEService *svc = srv->createService(SVC_UUID);
  chr = svc->createCharacteristic(CHR_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  chr->setCallbacks(new Cmd());
  chr->setValue("SHUT");
  svc->start();
  BLEDevice::getAdvertising()->addServiceUUID(SVC_UUID);
  BLEDevice::startAdvertising();
  Serial.println("RideOn lock ready");
}

void loop() {
  // Closing: the renter pushes the shackle in; the latch switch tells us it is really home.
  static bool wasShut = true;
  bool shut = digitalRead(LATCH_PIN) == LOW;
  if (shut && !wasShut) { bolt.write(SHUT_DEG); report("SHUT"); }
  wasShut = shut;
  if (!BLEDevice::getServer()->getConnectedCount()) BLEDevice::startAdvertising();
  delay(50);
}
