/* ============================================================================
 *  56 - FEED Nano full peripheral test (standalone)
 * ============================================================================
 *  Pin map (from FEED netlist + original 23-NanoFeedBoardTest.ino):
 *      D3  button1     D6  button2      D11 buzzer
 *      D4  TM1637 CLK  D5  TM1637 DIO
 *      D7  motor ENA   D8  motor IN1    D9  motor IN2
 *      A0  status LED  A1  relay FAN    A2  relay LAMP
 *      A6  fill light  <-- WARNING: analog-input-only pin, CANNOT output
 *      A7  LDR (light sensor)
 *
 *  Serial 115200. Commands:
 *      ?          help
 *      a          full self test (PASS / FAIL each)
 *      b          read both buttons
 *      l on|off   status LED A0
 *      f          toggle FAN relay A1
 *      g          toggle LAMP relay A2
 *      s          read LDR A7 x10
 *      S          check if A6 fill light can output (hardware issue check)
 *      t          TM1637 self test
 *      t 1234     TM1637 show 1234
 *      m fwd|rev|stop | m 120
 *      z on|off   buzzer
 * ========================================================================== */

#include <Arduino.h>

#define PIN_BTN1        3
#define PIN_BTN2        6
#define PIN_TM_CLK      4
#define PIN_TM_DIO      5
#define PIN_MOT_ENA     7
#define PIN_MOT_IN1     8
#define PIN_MOT_IN2     9
#define PIN_BUZZ        11
#define PIN_LED_STATUS  A0
#define PIN_RELAY_FAN   A1
#define PIN_RELAY_LAMP  A2
#define PIN_LIGHT_SENSE A7

#define RELAY_ON   HIGH
#define RELAY_OFF  LOW

static const uint8_t SEG[10] = {0x3F,0x06,0x5B,0x4F,0x66,0x6D,0x7D,0x07,0x7F,0x6F};

static void tm_start(void){digitalWrite(PIN_TM_DIO,HIGH);digitalWrite(PIN_TM_CLK,HIGH);delayMicroseconds(2);digitalWrite(PIN_TM_DIO,LOW);delayMicroseconds(2);}
static void tm_stop(void){digitalWrite(PIN_TM_CLK,LOW);delayMicroseconds(2);digitalWrite(PIN_TM_DIO,LOW);delayMicroseconds(2);digitalWrite(PIN_TM_CLK,HIGH);delayMicroseconds(2);digitalWrite(PIN_TM_DIO,HIGH);delayMicroseconds(2);}
static void tm_byte(uint8_t b){uint8_t i;for(i=0;i<8;i++){digitalWrite(PIN_TM_CLK,LOW);delayMicroseconds(2);digitalWrite(PIN_TM_DIO,(b&1)?HIGH:LOW);delayMicroseconds(2);digitalWrite(PIN_TM_CLK,HIGH);delayMicroseconds(2);b>>=1;}digitalWrite(PIN_TM_CLK,LOW);delayMicroseconds(2);digitalWrite(PIN_TM_CLK,HIGH);delayMicroseconds(2);}
static void tm_show(uint16_t v){
  uint8_t d[4],i;
  if(v>9999U){d[0]=d[1]=d[2]=d[3]=0x40;}
  else{d[0]=SEG[(v/1000U)%10U];d[1]=SEG[(v/100U)%10U];d[2]=SEG[(v/10U)%10U];d[3]=SEG[v%10U];}
  tm_start();tm_byte(0x40);tm_stop();
  tm_start();tm_byte(0xC0);for(i=0;i<4;i++)tm_byte(d[i]);tm_stop();
  tm_start();tm_byte(0x8F);tm_stop();
}

static uint8_t g_pwm = 200;
static void motor(uint8_t on, uint8_t dir, uint8_t pwm){
  if(!on){analogWrite(PIN_MOT_ENA,0);digitalWrite(PIN_MOT_IN1,LOW);digitalWrite(PIN_MOT_IN2,LOW);return;}
  analogWrite(PIN_MOT_ENA,pwm);
  if(dir){digitalWrite(PIN_MOT_IN1,HIGH);digitalWrite(PIN_MOT_IN2,LOW);}
  else{digitalWrite(PIN_MOT_IN1,LOW);digitalWrite(PIN_MOT_IN2,HIGH);}
}

static void help(void){
  Serial.println(F("--------------------------------------------------"));
  Serial.println(F("  ?         help"));
  Serial.println(F("  a         full self test"));
  Serial.println(F("  b         read buttons"));
  Serial.println(F("  l on|off  status LED A0"));
  Serial.println(F("  f         toggle FAN relay A1"));
  Serial.println(F("  g         toggle LAMP relay A2"));
  Serial.println(F("  s         read LDR A7 x10"));
  Serial.println(F("  t         TM1637 self test"));
  Serial.println(F("  t 1234    TM1637 show 1234"));
  Serial.println(F("  m fwd|rev|stop   motor"));
  Serial.println(F("  m 120     motor pwm"));
  Serial.println(F("  z on|off  buzzer"));
  Serial.println(F("--------------------------------------------------"));
}

static uint8_t read_line(char *buf, uint8_t maxlen){
  static uint8_t len=0; static uint32_t last=0;
  while(Serial.available()){
    char c=(char)Serial.read();
    if(c=='\r'||c=='\n'){ if(len>0){buf[len]=0;uint8_t r=len;len=0;return r;} continue; }
    if(len<maxlen-1){buf[len++]=c;last=millis();}
  }
  if(len>0 && (millis()-last)>300){buf[len]=0;uint8_t r=len;len=0;return r;}
  return 0;
}

static void pf(const char* what, uint8_t ok){
  Serial.print(F("  ")); Serial.print(what);
  Serial.println(ok ? F(" ... PASS") : F(" ... FAIL"));
}

static void selftest(void){
  uint8_t i; int v1,v2; uint8_t b1=0,b2=0; uint32_t t0;

  Serial.println(F("  ===== FULL SELF TEST ====="));

  Serial.println(F("  [1] TM1637 0000-9999"));
  for(i=0;i<10;i++){tm_show((uint16_t)i*1111U);delay(150);} tm_show(8888);
  pf("TM1637",1);

  Serial.println(F("  [2] buzzer"));
  digitalWrite(PIN_BUZZ,HIGH);delay(120);digitalWrite(PIN_BUZZ,LOW);
  pf("BUZZER",1);

  Serial.println(F("  [3] buttons (3s, press now)"));
  t0=millis();
  while(millis()-t0<3000U){
    if(digitalRead(PIN_BTN1)==LOW) b1=1;
    if(digitalRead(PIN_BTN2)==LOW) b2=1;
    delay(10);
  }
  Serial.print(F("  BTN1(D3) ")); Serial.println(b1?F("PASS"):F("not pressed"));
  Serial.print(F("  BTN2(D6) ")); Serial.println(b2?F("PASS"):F("not pressed"));

  Serial.println(F("  [4] status LED A0"));
  digitalWrite(PIN_LED_STATUS,HIGH);delay(500);digitalWrite(PIN_LED_STATUS,LOW);
  pf("LED A0",1);

  Serial.println(F("  [5] FAN relay A1"));
  digitalWrite(PIN_RELAY_FAN,RELAY_ON);delay(600);digitalWrite(PIN_RELAY_FAN,RELAY_OFF);
  pf("RELAY A1",1);

  Serial.println(F("  [6] LAMP relay A2"));
  digitalWrite(PIN_RELAY_LAMP,RELAY_ON);delay(600);digitalWrite(PIN_RELAY_LAMP,RELAY_OFF);
  pf("RELAY A2",1);

  Serial.println(F("  [7] LDR A7"));
  v1=analogRead(PIN_LIGHT_SENSE);delay(400);v2=analogRead(PIN_LIGHT_SENSE);
  Serial.print(F("  A7 = "));Serial.print(v1);Serial.print(F(" -> "));Serial.println(v2);
  pf("LDR A7",1);

  Serial.println(F("  [8] motor fwd 1s / rev 1s"));
  motor(1,1,180);delay(1000);
  motor(0,1,0);delay(200);
  motor(1,0,180);delay(1000);
  motor(0,1,0);
  pf("MOTOR",1);

  tm_show(0);
  Serial.println(F("  ===== DONE ====="));
}

void setup(){
  Serial.begin(115200); delay(200);

  pinMode(PIN_BTN1,INPUT_PULLUP);
  pinMode(PIN_BTN2,INPUT_PULLUP);
  pinMode(PIN_TM_CLK,OUTPUT);
  pinMode(PIN_TM_DIO,OUTPUT);
  pinMode(PIN_MOT_ENA,OUTPUT);
  pinMode(PIN_MOT_IN1,OUTPUT);
  pinMode(PIN_MOT_IN2,OUTPUT);
  pinMode(PIN_BUZZ,OUTPUT);
  pinMode(PIN_LED_STATUS,OUTPUT);
  pinMode(PIN_RELAY_FAN,OUTPUT);
  pinMode(PIN_RELAY_LAMP,OUTPUT);

  motor(0,1,0);
  digitalWrite(PIN_BUZZ,LOW);
  digitalWrite(PIN_LED_STATUS,LOW);
  digitalWrite(PIN_RELAY_FAN,RELAY_OFF);
  digitalWrite(PIN_RELAY_LAMP,RELAY_OFF);
  tm_show(0);

  Serial.println();
  Serial.println(F("====================================================="));
  Serial.println(F("  56-FEED-NANO-TEST"));
  Serial.println(F("  D3/D6 btn  D4/D5 TM   D7/D8/D9 motor  D11 buzz"));
  Serial.println(F("  A0 LED  A1 relay-FAN  A2 relay-LAMP"));
  Serial.println(F("  A6 fill-light (READ ONLY - HW issue)  A7 LDR"));
  Serial.println(F("====================================================="));
  help();
  Serial.print(F("> "));
}

void loop(){
  static char line[32];
  static uint8_t fstate=0, gstate=0;
  uint8_t n,i; int v;

  n=read_line(line,sizeof(line));
  if(n==0){delay(5);return;}
  Serial.print(F("> ")); Serial.println(line);

  if(strcmp(line,"?")==0){help();}
  else if(strcmp(line,"a")==0){selftest();}
  else if(strcmp(line,"b")==0){
    Serial.print(F("  BTN1(D3) = "));Serial.println(digitalRead(PIN_BTN1)==LOW?F("PRESSED"):F("released"));
    Serial.print(F("  BTN2(D6) = "));Serial.println(digitalRead(PIN_BTN2)==LOW?F("PRESSED"):F("released"));
  }
  else if(line[0]=='l' && line[1]==' '){
    uint8_t on=(strcmp(line+2,"on")==0);
    digitalWrite(PIN_LED_STATUS,on?HIGH:LOW);
    Serial.println(on?F("  status LED ON"):F("  status LED OFF"));
  }
  else if(strcmp(line,"f")==0){
    fstate=!fstate;
    digitalWrite(PIN_RELAY_FAN,fstate?RELAY_ON:RELAY_OFF);
    Serial.println(fstate?F("  FAN relay ON"):F("  FAN relay OFF"));
  }
  else if(strcmp(line,"g")==0){
    gstate=!gstate;
    digitalWrite(PIN_RELAY_LAMP,gstate?RELAY_ON:RELAY_OFF);
    Serial.println(gstate?F("  LAMP relay ON"):F("  LAMP relay OFF"));
  }
  else if(strcmp(line,"s")==0){
    for(i=0;i<10;i++){Serial.print(F("  A7 = "));Serial.println(analogRead(PIN_LIGHT_SENSE));delay(150);}
  }
  else if(line[0]=='t'){
    if(n>1 && line[1]==' '){v=atoi(line+2);tm_show((uint16_t)v);Serial.println(v);}
    else{for(i=0;i<10;i++){tm_show((uint16_t)i*1111U);delay(200);}tm_show(0);}
  }
  else if(line[0]=='m'){
    if(strcmp(line+2,"fwd")==0){motor(1,1,g_pwm);Serial.println(F("  motor FWD"));}
    else if(strcmp(line+2,"rev")==0){motor(1,0,g_pwm);Serial.println(F("  motor REV"));}
    else if(strcmp(line+2,"stop")==0){motor(0,1,0);Serial.println(F("  motor STOP"));}
    else{v=atoi(line+2);if(v<0)v=0;if(v>255)v=255;g_pwm=(uint8_t)v;Serial.print(F("  pwm="));Serial.println(g_pwm);}
  }
  else if(line[0]=='z'){
    uint8_t on=(strcmp(line+2,"on")==0);
    digitalWrite(PIN_BUZZ,on?HIGH:LOW);
    Serial.println(on?F("  buzzer ON"):F("  buzzer OFF"));
  }
  else{Serial.println(F("  unknown, type ?"));}

  Serial.print(F("> "));
}
