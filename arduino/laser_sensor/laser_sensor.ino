// Sensors: digital laser receiver modules
// Observed on this hardware: LOW = beam detected, HIGH = beam interrupted
// Audio playback is done host-side (Node.js) so multiple sensors can sound simultaneously.
//
// SENSOR_OFFSET shifts the reported sensor numbers. With two boards each driving
// 5 strings, build one with offset 0 (reports 1..5) and the other with offset 5
// (reports 6..10). Override at compile time with:
//   arduino-cli compile --build-property "compiler.cpp.extra_flags=-DSENSOR_OFFSET=5"
#ifndef SENSOR_OFFSET
#define SENSOR_OFFSET 0
#endif

const int NUM_SENSORS = 5;
const int SENSOR_PINS[NUM_SENSORS] = {A1, A2, A3, A4, A5};
const unsigned long DEBOUNCE_MS = 5;

bool laserBlocked[NUM_SENSORS] = {false};
unsigned long lastChangeTime[NUM_SENSORS] = {0};
unsigned long lastDebugTime = 0;

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.print("{\"event\":\"hello\",\"range\":[");
  Serial.print(1 + SENSOR_OFFSET);
  Serial.print(",");
  Serial.print(NUM_SENSORS + SENSOR_OFFSET);
  Serial.println("]}");

  for (int i = 0; i < NUM_SENSORS; i++) {
    pinMode(SENSOR_PINS[i], INPUT);
    int value = digitalRead(SENSOR_PINS[i]);
    laserBlocked[i] = (value == HIGH);

    Serial.print("{\"event\":\"boot\",\"sensor\":");
    Serial.print(i + 1 + SENSOR_OFFSET);
    Serial.print(",\"value\":");
    Serial.print(value);
    Serial.println("}");
  }

  Serial.println("{\"event\":\"ready\"}");
}

void loop() {
  unsigned long now = millis();
  int values[NUM_SENSORS];

  for (int i = 0; i < NUM_SENSORS; i++) {
    values[i] = digitalRead(SENSOR_PINS[i]);
    bool blocked = (values[i] == HIGH);

    if (blocked != laserBlocked[i] && (now - lastChangeTime[i] > DEBOUNCE_MS)) {
      laserBlocked[i] = blocked;
      lastChangeTime[i] = now;

      Serial.print("{\"event\":\"");
      Serial.print(blocked ? "interrupted" : "restored");
      Serial.print("\",\"sensor\":");
      Serial.print(i + 1 + SENSOR_OFFSET);
      Serial.print(",\"value\":");
      Serial.print(values[i]);
      Serial.println("}");
    }
  }

  if (now - lastDebugTime > 500) {
    lastDebugTime = now;
    Serial.print("{\"event\":\"debug\",\"values\":[");
    for (int i = 0; i < NUM_SENSORS; i++) {
      if (i > 0) Serial.print(",");
      Serial.print(values[i]);
    }
    Serial.println("]}");
  }
}
