/*Webserial Terminal 
Sebastian Braun
Version 6.0(22.07.23)
ModbusRTU-Version of Webserial Terminal

Communication to specific sensor as well as to any Modbus device possible.

Multiple settings for connections such as Baudrate, databits, stop bits, and parity mode

3 ways of communication
  1. Single measurement (via one of the two buttons)
  2. multimeasurement (via Measurement Series Button) with multiple settings
      up to 5 connected sensors
      live updated data in chart (of all sensors in individual charts or combined charts)
      manual stop or specific measurement time
      adjustable measurment frequency (up to 1 Hz)
      two measurands at the same time
      data export in diferent file formats
  3. Modbus Config Mode (viaModbus setings) that allows individual built telegrams with different function codes

Several additional features for the terminal 
  autoscroll
  very detailed debug mode
Chart settings
  adding and removing a scrollbar
  fixing axes to a certain value 
  all while running measurements 


            
*/

/**************GLOBAL vARIABLES*********************************************************************************/
// IntervalIds of functions that are called in a specific frequency
let scrollIntervalId;
let newlineIntervalId;
let getTempIntervalId;
let getHumIntervalId;
let getTemp_HumIntervalId;
let busyCounterIntervalId = 0;
// Port Objekt
let port;
// reader object from port to read serial data
let reader;
// writer object from port to write serial data
let writer;

// Variables to track state of HTML elements
// Port connected?
let connected = false;
// visualisation on?
let visualisation = false;
//modbus ConfigMode enabled?
let modbusConfig = false;
//debug enabled?
let debug = false;
//autoscroll enabled?
let autoScroll = true;
// menu status (next to terminal)
let menu = "measurementSettings";
//fiexes Axes?
let axesFixed = false;
// scrollbar visible
let scrollBar = false;
// multiple  series in one chart?
let chartsCombined = false;



// Variables for measurements
// Commands for Sensor Firmware to receive temperature and humidity value
// address Byte and crc checksum are not included and depend on the address chosen in the terminal
const getTemperature = new Uint8Array([3, 0, 0, 0, 1]);
const getHumidity = new Uint8Array([3, 0, 6, 0, 1]);
// variable for received Bytes before processing
let readValueArray = [];
// variables for the measured values (up to 5 sensors can be connected)
let correctTempValues = [[], [], [], [], []];
let correctHumValues = [[], [], [], [], []];
// variable that stores both temperature and humidity Values as well as time stamps and will be exported 
let exportData = [];
let exportDate = new Date();
// variables that store the settings for a measurement series
let measurand = "empty";
let measurementPeriod = 0;
let measurementTime = 0;
let manualStop = false;
let addressBytes = new Uint8Array([]);
// series of measurement running
let runningMeasurement = false;
// counter to differentiate between temp and hum measurement and to count number of saved values
let measurementCounter;
// Variable that keeps track of the current sensor that is correspondet with
let addressCounter;
//Variable that helps identifying between temp and hum responses during transmition and receiving process
let parameterInChanel = "";
// variabel that indicates if there is a communication process between browser and device activ
let chanelBusy = false;
//counter if chanel is busy for to long (some error)
let busyCounter = 0;


// Variables for chart settings
// Axes Values
let tempUpper, tempLower, humUpper, humLower;
// filename for Export
let filename = "";

// Variables for Chart Objects
// global object that sores id of used root variables
let globalRootObject = {};
// global variables for temp an hum series of multiple charts
let tempSeries = [];
let humSeries = [];




/******************************************************************************************************************************************* */


// when opening the webpage this checks automatically if the serial api is supported in the used browser
if ("serial" in navigator) {
  document.getElementById("terminal").innerHTML += "Welcome to the Modbus-Webterminal!<br>";
  document.getElementById("terminal").innerHTML += "<br>When successfully connected you can choose between the following options:<ul>";
  document.getElementById("terminal").innerHTML += "<li>In order to get single measurements of either temperature or humidity press one of the two buttons on the right.";
  document.getElementById("terminal").innerHTML += "Make sure the right default address is selected.</li><br><br>";
  document.getElementById("terminal").innerHTML += "<li>If you want to run a series of measurements press the third button and fill out the relevant settings.";
  document.getElementById("terminal").innerHTML += "After starting the measurements you have different options of data visualisation.<br>";
  document.getElementById("terminal").innerHTML += "Also you can export your data in different file formats after finishing the measurements.</li><br><br>";
  document.getElementById("terminal").innerHTML += "<li>On the top right you can also access a config mode for modbus commands where you can write individual commands with up to six bytes.";
  document.getElementById("terminal").innerHTML += "In Modbus Config Mode received data will be displayed in Arrays of Uint8.</li><br><br>";
  document.getElementById("terminal").innerHTML += "<li>The debug button allows a very detailed comprehension of the processed data during transmittion and receiving process.</li><br><br>";
}
else {
  document.getElementById("terminal").innerHTML += "The Web Serial API is not supportet!<br>";
}

/***********************************************Functions for receiving Data**************************************************************** */

// this function creates a port object and allows a connection to a connected serial device 
// when thee is readable data awailable it will be displayed on the terminal container 
async function connectComPort() {
  if (connected == false) {
    // Prompt user to select any serial port. returns a SerialPort object. 
    // because of await the next code line is only executed once the preveous one is completed
    port = await navigator.serial.requestPort();
    let baudrate = document.getElementById("baudrate").value;
    document.getElementById("terminal").innerHTML += "<br>Selected baudrate:  ";
    document.getElementById("terminal").innerHTML += baudrate;
    let dataBits = document.getElementById("data").value;
    let stopBits = document.getElementById("stop").value;
    let parity = document.getElementById("parity").value;
    // Wait for the serial port to open.
    await port.open({ baudRate: baudrate, dataBits: dataBits, stopBits: stopBits, parity: parity });
    document.getElementById("terminal").innerHTML += "<br>Serial device connected!<br><br><br>";
    // change status of port button and connected variable
    document.getElementById("connect").innerHTML = "Disconnect";
    connected = true;
    // enable autoscroll
    scrollIntervalId = setInterval(scrolling, 1000 / 5);
    while (port.readable) {
      // creates reader and locks readable to it
      reader = port.readable.getReader();
      try {
        while (true) {
          // returns two properties (value and done)
          //if done is true, the serial port has been closed or no more data is coming
          // value is an Uint8Array
          const { value, done } = await reader.read();
          if (done) {
            // Allow the serial port to be closed later. readable isnt locked any longer
            reader.releaseLock();
            break;
          }
          // if data is received it will be stored in an array (readValueArray)
          // Once this array contains a CR sign the array is converted to a string and displayed in the webpages terminal
          // if a serial measurement is running (runningMeasurement == true) the data is stored in another Object in safeData()
          // there is no interpretation of the data before it is displayed!!
          if (value) {
            if (debug) {
              document.getElementById("terminal").innerHTML += "<br>this is a raw received int8Array: ";
              document.getElementById("terminal").innerHTML += value;
            }
            //write Array chunk into Array for the whole message
            //when using the modbus Config mode more, the following comments need to be removed
            let length = readValueArray.length;
            for (let i = 0; i < value.length; i++) {
              readValueArray[length + i] = value[i];

            }
            clearInterval(busyCounterIntervalId);
            busyCounterIntervalId = 0;
            dataProcessing(readValueArray);
          }
        }
      }
      catch (error) {
        // TODO: Handle non-fatal read error.
      }
    }
    await port.close();
    document.getElementById("connect").innerHTML = "Connect";
    document.getElementById("baudrate").value = "";

    connected = false;
  }
  else {
    reader.releaseLock();
    await port.close();
    document.getElementById("connect").innerHTML = "Connect";
    document.getElementById("baudrate").value = "";
    if (runningMeasurement) {
      startMeasurements();
    }
    connected = false;
  }
}

// this function processes the received data by converting the dataBits to a float value, 
// differentiates between temp and hum values and stores the data in order to display it in the graph 
// if a measurment series is running
function dataProcessing(array) {
  // the received array is an answer to a command from measurement mode
  if (readValueArray.length == 7 && !modbusConfig) {
    let rawData = array.slice(0, array.length - 2);
    let crcGenerated = crc_generator(rawData);
    let crcReceived = array.slice(array.length - 2);
    if (debug) {
      document.getElementById("terminal").innerHTML += "<br><br><h2>ReceivingProcess:</h2>";
      document.getElementById("terminal").innerHTML += "<h3>Measurement Mode:</h3>";
      document.getElementById("terminal").innerHTML += "this is the assembled int8Array: ";
      document.getElementById("terminal").innerHTML += readValueArray;
      document.getElementById("terminal").innerHTML += "<h4>CRC Error check:</h4>";
      document.getElementById("terminal").innerHTML += "<br>without the CRC checksum: ";
      document.getElementById("terminal").innerHTML += rawData;
      document.getElementById("terminal").innerHTML += "<br>passed CRC (intValues): ";
      document.getElementById("terminal").innerHTML += crcReceived;
      document.getElementById("terminal").innerHTML += "<br>generated CRC (intValues): ";
      document.getElementById("terminal").innerHTML += crcGenerated;
      document.getElementById("terminal").innerHTML += "<br><br>";
    }

    // if the passed crc and the calculated crc are identical the data can be processed
    if (parseInt(crcReceived) == parseInt(crcGenerated)) {
      // Databytes are cut out
      let dataBytes = array.slice(3, 5);
      // converting Uint8 to hex String
      let hexString = Array.from(dataBytes).map((i) => i.toString(16).padStart(2, '0')).join('');
      // converting hexString to decimal
      let decimal = parseInt(hexString, 16);
      // converting decimal to float
      let float = parseFloat(decimal);
      if (debug) {
        document.getElementById("terminal").innerHTML += "<h3>Data processing: (CRC erroc check passed)</h3>";
        document.getElementById("terminal").innerHTML += "sliced two Bytes: ";
        document.getElementById("terminal").innerHTML += dataBytes;
        document.getElementById("terminal").innerHTML += " (the Bytes are swapped and then converted to hex)";
        document.getElementById("terminal").innerHTML += "<br>hex value: ";
        document.getElementById("terminal").innerHTML += hexString;
        document.getElementById("terminal").innerHTML += "<br>Decimal number: ";
        document.getElementById("terminal").innerHTML += decimal;
        document.getElementById("terminal").innerHTML += "<br>";
      }
      let newValue;
      let date = new Date();
      //timestamp safed for export table if the measurement is from the first adress and a temperature value
      if (runningMeasurement && addressCounter == 0 && measurementCounter % 2 == 0) {
        exportDate = date;
      }


      // parameterInChanel indicates the command that was send last
      if (parameterInChanel == "temp") {
        newValue = float / 100 - 100; // calculating the temperature out of float value
        // fix value to two decimals (returns a string so it has to be parsed to float again)
        newValue = parseFloat(newValue.toFixed(2))
        // during a measurement series the value and the time is stored in an array
        // and updated in the chart
        if (runningMeasurement) {
          correctTempValues[addressCounter].push({ date: date, value: newValue });
          liveData(correctTempValues[addressCounter], tempSeries[addressCounter]);
          measurementCounter++;
        }
        //dsiplay value in terminal
        document.getElementById("terminal").innerHTML += "<br>Temperature:&nbsp;&nbsp;  ";
        document.getElementById("terminal").innerHTML += newValue;
        document.getElementById("terminal").innerHTML += " °C";
      }
      else if (parameterInChanel == "hum") {
        newValue = float / 100;
        newValue = parseFloat(newValue.toFixed(2))
        if (runningMeasurement) {
          correctHumValues[addressCounter].push({ date: date, value: newValue });
          liveData(correctHumValues[addressCounter], humSeries[addressCounter]);
          measurementCounter++;
        }
        document.getElementById("terminal").innerHTML += "<br>Humidity:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ";
        document.getElementById("terminal").innerHTML += newValue;
        document.getElementById("terminal").innerHTML += " %&nbsp;";
      }

      //display measurement counter in terminal
      if (runningMeasurement) {
        document.getElementById("terminal").innerHTML += "&nbsp;&nbsp;Address:&nbsp;";
        document.getElementById("terminal").innerHTML += addressBytes[addressCounter];
        document.getElementById("terminal").innerHTML += "&nbsp;&emsp;&nbsp;Measurement No.";
        document.getElementById("terminal").innerHTML += measurementCounter;

      }
      let compare = addressCounter;
      if ((compare + 1) == addressBytes.length) {
        // measurements are saved additionally in exportData.
        // when values from all onnected sensors are received the stored data ist put into the export variable in json format
        safeForExport();
      }
    }
    // if they are not identical a crc error occured and the data is not valid
    else {
      document.getElementById("terminal").innerHTML += "<br>CRC error! ";
    }

    // next Sensor address if a) only one measurand b) both measurands and current measurand is hum (is send // secondly)
    if (measurand == "temp" || measurand == "hum" || (measurand == "double" && parameterInChanel == "hum")) {
      addressCounter++;
      if (addressCounter == addressBytes.length) {
        // measurements are saved additionally in exportData.
        // when values from all onnected sensors are received the stored data ist put into the export variable in json format
        addressCounter = 0;
      }
    }
    parameterInChanel = "";
    newValue = 0;
    //open chanel for next command
    chanelBusy = false;
    // the array is cleared for the next message
    readValueArray.length = 0;
    if (debug) {
      document.getElementById("terminal").innerHTML += "<br><br>Receiving Process done";
    }
  }

  // the received array is an answer to a command from modbus config mode AND is at least 4 Bytes (it needs to be a complete answer)
  else if (modbusConfig && readValueArray.length >= 4) {
    if (debug) {
      document.getElementById("terminal").innerHTML += "<br><br><h2>ReceivingProcess:</h2>";
      document.getElementById("terminal").innerHTML += "<h3>Modbus Config Mode:</h3>";
    }
    let rawData = array.slice(0, array.length - 2);
    let crcGenerated = crc_generator(rawData);
    let crcReceived = array.slice(array.length - 2);
    if (parseInt(crcReceived) == parseInt(crcGenerated)) {
      document.getElementById("terminal").innerHTML += "<br>Received Bytes as Integers:  ";
      document.getElementById("terminal").innerHTML += readValueArray;
    }
    //open chanel for next command
    chanelBusy = false;
    // the array is cleared for the next message
    readValueArray.length = 0;
    if (debug) {
      document.getElementById("terminal").innerHTML += "<br><br>Receiving Process done";
    }
  }

}


function safeForExport() {
  if (measurand == "double" && ((measurementCounter % 2) == 0)) {
    switch (addressBytes.length) {
      case 1: exportData.push({
        date: exportDate,
        Temperature: correctTempValues[0][correctTempValues[0].length - 1].value,
        Humidity: correctHumValues[0][correctHumValues[0].length - 1].value
      });
        break;
      case 2: exportData.push({
        date: exportDate,
        Temp_Sensor1: correctTempValues[0][correctTempValues[0].length - 1].value,
        Hum_Sensor1: correctHumValues[0][correctHumValues[0].length - 1].value,
        Temp_Sensor2: correctTempValues[1][correctTempValues[1].length - 1].value,
        Hum_Sensor2: correctHumValues[1][correctHumValues[1].length - 1].value
      });
        break;
      case 3: exportData.push({
        date: exportDate,
        Temp_Sensor1: correctTempValues[0][correctTempValues[0].length - 1].value,
        Hum_Sensor1: correctHumValues[0][correctHumValues[0].length - 1].value,
        Temp_Sensor2: correctTempValues[1][correctTempValues[1].length - 1].value,
        Hum_Sensor2: correctHumValues[1][correctHumValues[1].length - 1].value,
        Temp_Sensor3: correctTempValues[2][correctTempValues[2].length - 1].value,
        Hum_Sensor3: correctHumValues[2][correctHumValues[2].length - 1].value
      });
        break;
      case 4: exportData.push({
        date: exportDate,
        Temp_Sensor1: correctTempValues[0][correctTempValues[0].length - 1].value,
        Hum_Sensor1: correctHumValues[0][correctHumValues[0].length - 1].value,
        Temp_Sensor2: correctTempValues[1][correctTempValues[1].length - 1].value,
        Hum_Sensor2: correctHumValues[1][correctHumValues[1].length - 1].value,
        Temp_Sensor3: correctTempValues[2][correctTempValues[2].length - 1].value,
        Hum_Sensor3: correctHumValues[2][correctHumValues[2].length - 1].value,
        Temp_Sensor4: correctTempValues[3][correctTempValues[3].length - 1].value,
        Hum_Sensor4: correctHumValues[3][correctHumValues[3].length - 1].value
      });
        break;
      case 5: exportData.push({
        date: exportDate,
        Temp_Sensor1: correctTempValues[0][correctTempValues[0].length - 1].value,
        Hum_Sensor1: correctHumValues[0][correctHumValues[0].length - 1].value,
        Temp_Sensor2: correctTempValues[1][correctTempValues[1].length - 1].value,
        Hum_Sensor2: correctHumValues[1][correctHumValues[1].length - 1].value,
        Temp_Sensor3: correctTempValues[2][correctTempValues[2].length - 1].value,
        Hum_Sensor3: correctHumValues[2][correctHumValues[2].length - 1].value,
        Temp_Sensor4: correctTempValues[3][correctTempValues[3].length - 1].value,
        Hum_Sensor4: correctHumValues[3][correctHumValues[3].length - 1].value,
        Temp_Sensor5: correctTempValues[4][correctTempValues[4].length - 1].value,
        Hum_Sensor5: correctHumValues[4][correctHumValues[4].length - 1].value
      });
        break;
    }
  }
  else if (measurand == "temp") {
    correctTempValues[0][correctTempValues[0].length - 1].value
    switch (addressBytes.length) {
      case 1:
        exportData.push({
          date: exportDate,
          Temperature: correctTempValues[0][correctTempValues[0].length - 1].value
        });
        break;
      case 2: exportData.push({
        date: exportDate,
        Temp_Sensor1: correctTempValues[0][correctTempValues[0].length - 1].value,
        Temp_Sensor2: correctTempValues[1][correctTempValues[1].length - 1].value
      });
        break;
      case 3: exportData.push({
        date: exportDate,
        Temp_Sensor1: correctTempValues[0][correctTempValues[0].length - 1].value,
        Temp_Sensor2: correctTempValues[1][correctTempValues[1].length - 1].value,
        Temp_Sensor3: correctTempValues[2][correctTempValues[2].length - 1].value
      });
        break;
      case 4: exportData.push({
        date: exportDate,
        Temp_Sensor1: correctTempValues[0][correctTempValues[0].length - 1].value,
        Temp_Sensor2: correctTempValues[1][correctTempValues[1].length - 1].value,
        Temp_Sensor3: correctTempValues[2][correctTempValues[2].length - 1].value,
        Temp_Sensor4: correctTempValues[3][correctTempValues[3].length - 1].value
      });
        break;
      case 5: exportData.push({
        date: exportDate,
        Temp_Sensor1: correctTempValues[0][correctTempValues[0].length - 1].value,
        Temp_Sensor2: correctTempValues[1][correctTempValues[1].length - 1].value,
        Temp_Sensor3: correctTempValues[2][correctTempValues[2].length - 1].value,
        Temp_Sensor4: correctTempValues[3][correctTempValues[3].length - 1].value,
        Temp_Sensor5: correctTempValues[4][correctTempValues[4].length - 1].value
      });
        break;
    }
  }
  else if (measurand == "hum") {
    switch (addressBytes.length) {
      case 1: exportData.push({
        date: exportDate,
        Humidity: correctHumValues[0][correctHumValues[0].length - 1].value
      });
        break;
      case 2: exportData.push({
        date: exportDate,
        Hum_Sensor1: correctHumValues[0][correctHumValues[0].length - 1].value,
        Hum_Sensor2: correctHumValues[1][correctHumValues[1].length - 1].value
      });
        break;
      case 3: exportData.push({
        date: exportDate,
        Hum_Sensor1: correctHumValues[0][correctHumValues[0].length - 1].value,
        Hum_Sensor2: correctHumValues[1][correctHumValues[1].length - 1].value,
        Hum_Sensor3: correctHumValues[2][correctHumValues[2].length - 1].value
      });
        break;
      case 4: exportData.push({
        date: exportDate,
        Hum_Sensor1: correctHumValues[0][correctHumValues[0].length - 1].value,
        Hum_Sensor2: correctHumValues[1][correctHumValues[1].length - 1].value,
        Hum_Sensor3: correctHumValues[2][correctHumValues[2].length - 1].value,
        Hum_Sensor4: correctHumValues[3][correctHumValues[3].length - 1].value
      });
        break;
      case 5: exportData.push({
        date: exportDate,
        Hum_Sensor1: correctHumValues[0][correctHumValues[0].length - 1].value,
        Hum_Sensor2: correctHumValues[1][correctHumValues[1].length - 1].value,
        Hum_Sensor3: correctHumValues[2][correctHumValues[2].length - 1].value,
        Hum_Sensor4: correctHumValues[3][correctHumValues[3].length - 1].value,
        Hum_Sensor5: correctHumValues[4][correctHumValues[4].length - 1].value
      });
        break;
    }
  }

}

/***************************************Functions for Transmitting Data********************************************************************** */

// this function calculates and returns the crc summ for a given Array
function crc_generator(array) {
  let crc = 0xFFFF;
  // go through each byte
  for (let i = 0; i < array.length; i++) {
    crc ^= array[i] & 0xFF; //XOR byte into least sig. byte of crc
    // go through each bit
    for (let i = 0; i < 8; i++) {
      let carry = crc & 0x0001;
      crc >>= 1;
      if (carry) crc ^= 0xA001;
    }
  }

  //convert crc value into two bytes of integer values
  let hex = crc.toString(16);  // conversion to a hexstring
  if (hex.length == 3) {       // if there is a leading zero one needs to be added
    let zero = "0";
    hex = zero.concat(hex);
  }
  let hexByteSwapped = hex.slice(2) + hex.slice(0, 2); // swap bytes of hexstring (to BigEndian)
  let crc_Bytes = [parseInt(hexByteSwapped.slice(0, 2), 16), parseInt(hexByteSwapped.slice(2), 16)]; // convert first hex-Byte to Integer and save in Array

  if (debug) {
    document.getElementById("terminal").innerHTML += "CRC dec: ";
    document.getElementById("terminal").innerHTML += crc;
    document.getElementById("terminal").innerHTML += "<br>CRC hex: ";
    document.getElementById("terminal").innerHTML += hex;
    document.getElementById("terminal").innerHTML += "<br>swapped hex: ";
    document.getElementById("terminal").innerHTML += hexByteSwapped;
    document.getElementById("terminal").innerHTML += "<br>CRC Bytes: ";
    document.getElementById("terminal").innerHTML += crc_Bytes;
    document.getElementById("terminal").innerHTML += "<br>";
  }
  return crc_Bytes;
}

// a simple function that writes the passed argument to the connected port
// the variable has to be a uint8Array!
// in the Modbus_RTU Version a 5-Byte array is passed (consisting of function code Byte, 16Bit for startaddress, 16but for number of registers to read out)
async function writeToPort(data) {
  if (debug) {
    document.getElementById("terminal").innerHTML += "<br><br><h2>Transmition process:</h2>";
  }
  let telegram = new Uint8Array([]);
  let array;
  let addressByte;
  let crcBytes;
  if (!modbusConfig) {
    if (debug) {
      document.getElementById("terminal").innerHTML += "<h3>Measurement Mode: </h3>";
      document.getElementById("terminal").innerHTML += "<h4>CRC generation:</h4>";

    }
    if (runningMeasurement) {
      //addressByte = new Uint8Array([addressBytes[addressCounter]]);
      addressByte = addressBytes[addressCounter];
    }
    else {
      //addressByte = new Uint8Array([document.getElementById("defaultAddress").value]);
      addressByte = document.getElementById("defaultAddress").value;

    }
    //store value of address input field as first element of array
    //array = new Uint8Array([addressByte[0], data[0], data[1], data[2], data[3], data[4]]);
    array = [addressByte, data[0], data[1], data[2], data[3], data[4]];
    crcBytes = crc_generator(array);
    telegram = Uint8Array.from(array.concat(crcBytes));

    if (debug) {
      document.getElementById("terminal").innerHTML += "<h4>Data composition:</h4>";
      document.getElementById("terminal").innerHTML += "raw Data: ";
      document.getElementById("terminal").innerHTML += data;
      document.getElementById("terminal").innerHTML += "<br>...including address Byte: ";
      document.getElementById("terminal").innerHTML += array;
      document.getElementById("terminal").innerHTML += "<br>...including crc Bytes to full telegram: ";
      document.getElementById("terminal").innerHTML += telegram;
      document.getElementById("terminal").innerHTML += "<br><br>";
    }
  }
  // in modbus config mode the address Byte is selected manually and already in the passed array
  else {
    if (debug) {
      document.getElementById("terminal").innerHTML += "<br><h3>Modbus Config Mode: </h3>";
      document.getElementById("terminal").innerHTML += "<h4>CRC generation:</h4>";
    }
    array = Array.from(data);
    crcBytes = crc_generator(array);
    telegram = Uint8Array.from(array.concat(crcBytes));
    if (debug) {
      document.getElementById("terminal").innerHTML += "Full telegram including crc Bytes: ";
      document.getElementById("terminal").innerHTML += telegram;
      document.getElementById("terminal").innerHTML += "<br><br>";
    }
  }

  if (!chanelBusy) {
    writer = port.writable.getWriter();
    await writer.write(telegram);
    if (debug) {
      document.getElementById("terminal").innerHTML += "<br>If ChanelBusy is false the telegram has been transmitted: ";
      document.getElementById("terminal").innerHTML += chanelBusy;
      document.getElementById("terminal").innerHTML += "<br><br>";
    }
    writer.releaseLock();
    if (telegram[3] == 0) {
      parameterInChanel = "temp";
    }
    else if (telegram[3] == 6) {
      parameterInChanel = "hum";
    }
    else {
      parameterInChanel = "undefined";
    }
    chanelBusy = true;
    busyCounter = 0;
    readValueArray.length = 0;
    if (busyCounterIntervalId == 0) {
      busyCounterIntervalId = setInterval(incrementBusyCounter, 100);
    }
  }
  else {
    document.getElementById("terminal").innerHTML += "<br>Chanel is busy, Telegram not transmitted!<br><br>";

  }
}

function incrementBusyCounter() {
  busyCounter++;
  if (((busyCounter == ((measurementPeriod * 10) - 1)) && measurand != "double") || ((busyCounter == ((measurementPeriod * 5) - 1)) && measurand == "double")) {
    chanelBusy = false;
    busyCounter = 0;
    if (debug) {
      document.getElementById("terminal").innerHTML += "<br><h4>ChanelBusy has been set = false due to timeout!</h4>";

    }
  }
}

// this function writes the commands for temperature and humidity to the port
// it is implemented seperately because there needs to be a specific time 
// inbetween commands in order for them to work properly
async function getTemp_Hum() {
  writeToPort(getTemperature);
  setTimeout(() => { writeToPort(getHumidity) }, 1000);
}

/***************************************************Functions about Measurement Settings********************************************************************* */

// this function replaces the html elements of the terminal container with the elements of the settings
// when the button 'serial measurements' is pressed
function showSettings() {
  if (!runningMeasurement) {
    //replace terminal with settings console
    document.getElementById("display").innerHTML = document.getElementById("settings").innerHTML;
    // hide buttons on side bar that are irrelevant now
    document.getElementById("startMeasurement").style.display = "none";
    document.getElementById("measurement").style.display = "none";
    document.getElementById("singleMeasurandDisplay").style.display = "none";
    document.getElementById("safeSettings").style.display = "block";
    document.getElementById("safeSettings").style.backgroundColor = "green";
    manualStop = false;
    menu = "Settings";
  }
}

function showFrequencyInfo() {
  document.getElementById("display").innerHTML = document.getElementById("frequencyInfo").innerHTML;

}

function hideFrequencyInfo() {
  document.getElementById("display").innerHTML = document.getElementById("settings").innerHTML;

}


// this function shows or hides the setting for specific measurment time 
//depending on the checkbox continuous measurment beiing checked
function hideTimeSetting() {
  if (document.getElementById("manualStop").checked) {
    document.getElementById("lableMeasTime").style.display = "none";
    document.getElementById("measurementTime").style.display = "none";
    manualStop = true;

  }
  else {
    document.getElementById("measurementTime").style.display = "block";
    document.getElementById("lableMeasTime").style.display = "block";
    manualStop = false;
  }
}

// this function stores the values of the settings in global variables
// when the button 'safe' is pressed
// it displays the safed settings on the webpages terminal
function safeSettings() {
  // assigning variable measurand
  if (document.getElementById("tempMeasurement").checked && document.getElementById("humMeasurement").checked) {
    measurand = "double";
  }
  else if (document.getElementById("tempMeasurement").checked && !document.getElementById("humMeasurement").checked) {
    measurand = "temp";
  }
  else if (!document.getElementById("tempMeasurement").checked && document.getElementById("humMeasurement").checked) {
    measurand = "hum";
  }
  else {
    measurand = "empty";
  }
  // assigning measurementPeriod and measurementTime
  measurementPeriod = document.getElementById("period").value;
  measurementTime = document.getElementById("measurementTime").value;
  // assigning the selected adressBytes to an array
  addressBytes = ([
    document.getElementById("sensorAddress1").value,
    document.getElementById("sensorAddress2").value,
    document.getElementById("sensorAddress3").value,
    document.getElementById("sensorAddress4").value,
    document.getElementById("sensorAddress5").value,
  ]);
  // shorten the array so that the amount of bytes matches the input for connected sensors
  addressBytes.length = document.getElementById("sensorCount").value;
  if (addressBytes.length == 1) {
    multipleCharts();
  }
  // error warnings
  if (addressBytes.length < 1 || addressBytes.length > 5) {
    window.alert("You can only connect between one and five sensors");
  }
  else if (addressBytes[0] == 0 || addressBytes[1] == 0 || addressBytes[2] == 0 || addressBytes[3] == 0 || addressBytes[4] == 0) {
    window.alert("You have to assign address values for the conected Sensors");
  }
  else if (measurand == "empty" || measurand == "") {
    window.alert("You need to select at least one measurand");
  }
  else if ((measurementPeriod < 2 && measurand == "double") || measurementPeriod < 1) {
    window.alert("The measurment frequency is to fast foer the selected measurands. For further limitations click the info button");
  }
  else if (manualStop == false && measurementTime == 0) {
    window.alert("Please chose a Measurement Time or select the manual stop option.");
  }
  // inputs are correct
  else {
    if (debug) {
      document.getElementById("terminal").style.fontSize = "1vw";
    }
    // show new buttons and change content, go back to terminal
    document.getElementById("safeSettings").style.display = "none";
    document.getElementById("safeSettings").style.backgroundColor = "white";
    document.getElementById("startMeasurement").innerHTML = "Start";
    document.getElementById("startMeasurement").style.display = "block";
    document.getElementById("startMeasurement").style.backgroundColor = "green";
    document.getElementById("measurement").style.display = "block";
    document.getElementById("singleMeasurandDisplay").style.display = "block";
    document.getElementById("display").innerHTML = '<div id="terminal" class="containerTerminal"></div>';
    menu = "startPage";
    // display measurment parameters
    document.getElementById("terminal").innerHTML = "Measurement Parameters:<br><br>";
    document.getElementById("terminal").innerHTML += "Connected Sensors: ";
    document.getElementById("terminal").innerHTML += addressBytes.length;
    document.getElementById("terminal").innerHTML += "<br>Address Bytes: ";
    document.getElementById("terminal").innerHTML += addressBytes;
    document.getElementById("terminal").innerHTML += "<br>Measurand: ";
    if (measurand == "temp") document.getElementById("terminal").innerHTML += "Temperature ";
    else if (measurand == "hum") document.getElementById("terminal").innerHTML += "Humidity ";
    else if (measurand == "double") document.getElementById("terminal").innerHTML += "Temperature & Humidity ";
    if (manualStop == true) {
      document.getElementById("terminal").innerHTML += "<br>Measurement will be stopped manually ";
    }
    else {
      document.getElementById("terminal").innerHTML += "<br>Total measurement time: ";
      document.getElementById("terminal").innerHTML += measurementTime;
      document.getElementById("terminal").innerHTML += " Second/s";
    }
    document.getElementById("terminal").innerHTML += "<br>Measurement period: ";
    document.getElementById("terminal").innerHTML += measurementPeriod;
    document.getElementById("terminal").innerHTML += " Second/s";
    document.getElementById("terminal").innerHTML += "<br><br>In order to start the measurement press the Start button!";
    document.getElementById("visualize").style.display = "block";
  }

}

/**********************************************Functions about enabling measurements************************************************************************* */

// this function starts the serial measurements with the global variables with the safed values from settings
// depending on the measurands interval functions are called in a specific frequency for a certain time before they are stopped
async function startMeasurements() {
  if (connected) {
    //check if there is already a measurment running
    // if not so
    if (runningMeasurement == false) {
      //clear terminal content
      document.getElementById("terminal").innerHTML = "";
      // set measurment intervals depending on the measurand
      // and measurmentPeriod setting
      if (measurand == "double") {
        getTemp_HumIntervalId = setInterval(getTemp_Hum, (measurementPeriod * 1000));
      }
      else if (measurand == "temp") {
        getTempIntervalId = setInterval(() => { writeToPort(getTemperature); }, measurementPeriod * 1000);

      }
      else if (measurand == "hum") {
        getHumIntervalId = setInterval(() => { writeToPort(getHumidity); }, measurementPeriod * 1000);
      }
      else {
        window.alert("Safe settings before starting the measurement!");
      }
      // if settings are valid
      if (measurand != "empty") {
        measurementCounter = 0;       // initialize measurement counter
        addressCounter = 0;           // initialize address Counter ( always starts with the first address from)
        runningMeasurement = true;    // set running measurement variable true
        for (let i = 0; i < addressBytes.length; i++) { // clear arrays for measurement values
          correctTempValues[i].length = 0;
          correctHumValues[i].length = 0;
        }
        // clear array for export Data
        exportData.length = 0;
        visualisation = false;        // set visualization variable false (so graph can be displayed when the buton is pressed)
        document.getElementById("visualize").innerHTML = "Show chart"; // put correct content in button when measurement is finished 
        document.getElementById("results").style.display = "none";  // hide graph when starting a new measurement
        document.getElementById("visualize").style.backgroundColor = "green";
        document.getElementById("singleMeasurandDisplay").style.display = "none";
        document.getElementById("measurement").style.display = "none";    //hide measurment-settings button
        document.getElementById("scrollbar").style.display = "none";
        document.getElementById("fixedAxes").style.display = "none";
        document.getElementById("combineCharts").style.display = "none";
        document.getElementById("export").style.display = "none";
        am5ready();   //build the chart
        //switch to chart settings
        document.getElementById("measurementSettings").style.display = "none";
        document.getElementById("chartSettings").style.display = "block";
        menu = "chartSettings";
        // disbable buttons for singlemeasurements during series
        document.getElementById("getTemp").disabled = true;
        document.getElementById("getHum").disabled = true;
        document.getElementById("backButton").style.display = "none";    //show measurment-settings button


        // checking wether measurement is stopped manually
        if (manualStop == false) {
          // timeout functions considering the measurmentTime Variables setted
          setTimeout(() => {
            clearInterval(getTempIntervalId); clearInterval(getHumIntervalId);
            clearInterval(getTemp_HumIntervalId)
          }, measurementTime * 1000);
          setTimeout(measurementFinished, measurementTime * 1000 + 1000);
          document.getElementById("startMeasurement").style.display = "none";
          document.getElementById("stopMeasurement").style.display = "none";

        }
        // if measurement is stopped manually
        else {
          document.getElementById("stopMeasurement").style.display = "block";
          document.getElementById("stopMeasurement").innerHTML = "Stop";
          document.getElementById("stopMeasurement").style.backgroundColor = "red";
        }
      }
      else {
        document.getElementById("terminal").innerHTML += "<br>You need to select at least one measurand before starting the measurement!<br>";
      }
    }
    // stop button (red) is pressed
    else {
      clearInterval(getTempIntervalId);
      clearInterval(getHumIntervalId);
      clearInterval(getTemp_HumIntervalId);
      await setTimeout(1000);
      document.getElementById("terminal").innerHTML += "<br><br>Measurement Done!";
      document.getElementById("terminal").innerHTML += "<br>Total number of saved values:";
      document.getElementById("terminal").innerHTML += measurementCounter;
      document.getElementById("terminal").innerHTML += "<br><br>";
      runningMeasurement = false;
      document.getElementById("stopMeasurement").innerHTML = "Start";
      document.getElementById("stopMeasurement").style.backgroundColor = "green";
      document.getElementById("getTemp").disabled = false;
      document.getElementById("getHum").disabled = false;
      document.getElementById("singleMeasurandDisplay").style.display = "block";
      document.getElementById("measurement").style.display = "block";    //show measurment-settings button
      document.getElementById("backButton").style.display = "block";    //show measurment-settings button
      clearInterval(busyCounterIntervalId);
      busyCounterIntervalId = 0;
    }

  }
  else {
    window.alert("Connect to COM Port first");
  }

}

// function is callled in the function above when the measurement is finished
function measurementFinished() {
  document.getElementById("terminal").innerHTML += "<br><br>Measurement Done!";
  document.getElementById("terminal").innerHTML += "<br>Total number of saved values: ";
  document.getElementById("terminal").innerHTML += measurementCounter;
  document.getElementById("terminal").innerHTML += "<br><br>";
  document.getElementById("startMeasurement").innerHTML = "Start";
  runningMeasurement = false;
  document.getElementById("startMeasurement").style.display = "block";
  document.getElementById("getTemp").disabled = false;
  document.getElementById("getHum").disabled = false;
  document.getElementById("singleMeasurandDisplay").style.display = "block";
  document.getElementById("measurement").style.display = "block";    //show measurment-settings button
  document.getElementById("backButton").style.display = "block";    //show measurment-settings button
  clearInterval(busyCounterIntervalId);
  busyCounterIntervalId = 0;


}


/**************************************Functions for Diesplay & Terminal settings*************************************************************************** */

// this function clears the content of the webpages terminal
function clearTerminal() {
  document.getElementById("terminal").innerHTML = "";

}

// this function calles the autoscroll function when the corrsponding button is pressed
function autoscroll() {
  if (!autoScroll) {
    scrollIntervalId = setInterval(scrolling, 1000 / 5);
    document.getElementById("autoscroll").innerHTML = "Disable Autoscroll";
    autoScroll = true;
  }
  else if (autoScroll) {
    clearInterval(scrollIntervalId);
    document.getElementById("autoscroll").innerHTML = "Enable Autoscroll";
    autoScroll = false
  }
}

// this function enables autoscroll when there is an overflow in the y-axis of the terminal
function scrolling() {
  let scrollBox = document.getElementById("terminal");
  if (scrollBox.scrollTop < (scrollBox.scrollHeight - scrollBox.offsetHeight)) {
    scrollBox.scrollTop = scrollBox.scrollHeight;
  }
}



function enableDebug() {
  if (debug == false) {
    document.getElementById("debugButton").innerHTML = "Disable Debug";
    document.getElementById("terminal").style.fontSize = "1vw";
    debug = true;
  }
  else if (debug == true) {
    document.getElementById("debugButton").innerHTML = "Enable Debug";
    document.getElementById("terminal").style.fontSize = "1.5vw";

    debug = false;
  }
}

/********************************************Functions for Modbus configuration *************************************************************************/

function enableModbusConfig() {
  if (connected) {
    if (modbusConfig == false) {
      if (runningMeasurement) {
        window.alert("stop running measurment first!")
      }
      else if (menu == "Settings") {
        window.alert("safe settings first!")
      }
      else {
        document.getElementById("menuContent").style.display = "none";
        document.getElementById("modbusConfigDiv").style.display = "block";
        document.getElementById("modbusConfigDiv").style.display = "flex";
        document.getElementById("display").innerHTML = document.getElementById("modbusConfigInfo").innerHTML;
        document.getElementById("modbusModeButton").innerHTML = "Enable Measurement Mode";
        menu = "ModbusSettings";
        modbusConfig = true;
      }
    }
    else {
      document.getElementById("modbusConfigDiv").style.display = "none";
      document.getElementById("menuContent").style.display = "block";
      document.getElementById("menuContent").style.display = "flex";
      document.getElementById("display").innerHTML = '<div id="terminal" class="containerTerminal"></div>';
      document.getElementById("modbusModeButton").innerHTML = "Enable Modbus Config Mode";

      modbusConfig = false;
    }
  }
  else {
    window.alert("Connect to COM Port first.");

  }
}

function openModbusExplanations() {
  window.open("https://modbus.org/docs/Modbus_Application_Protocol_V1_1b3.pdf");
}


function sendManualModbus() {
  if (connected) {
    document.getElementById("display").innerHTML = '<div id="terminal" class="containerTerminal"></div>';
    document.getElementById("terminal").innerHTML = "";
    if (debug) {
      document.getElementById("terminal").style.fontSize = "1vw";

    }

    let modbusTelegram = new Uint8Array([
      document.getElementById("address").value,
      document.getElementById("functionCode").value,
      document.getElementById("thirdByte").value,
      document.getElementById("fourthByte").value,
      document.getElementById("fifthByte").value,
      document.getElementById("sixthByte").value
    ]);
    writeToPort(modbusTelegram);



  }
  else {
    window.alert("Connect to COM Port first.");
  }

}

/********************************************Functions for Data Visualisation****************************************************************************/

// this function allows to show or hide the visualisation graph
// when a measurement series is finished 
function showResults() {
  if (visualisation == false) {
    document.getElementById("results").style.display = "block";
    document.getElementById("visualize").style.backgroundColor = "red";
    document.getElementById("visualize").innerHTML = "Hide chart";
    document.getElementById("scrollbar").style.display = "block";
    document.getElementById("fixedAxes").style.display = "block";
    document.getElementById("combineCharts").style.display = "block";
    document.getElementById("export").style.display = "block";



    visualisation = true;
  }
  else {
    document.getElementById("results").style.display = "none";
    document.getElementById("visualize").style.backgroundColor = "green";
    document.getElementById("visualize").innerHTML = "Show chart";
    document.getElementById("scrollbar").style.display = "none";
    document.getElementById("fixedAxes").style.display = "none";
    document.getElementById("combineCharts").style.display = "none";
    document.getElementById("export").style.display = "none";
    visualisation = false;
  }

}

function fixAxes() {
  if (axesFixed == false) {
    document.getElementById("visualize").style.display = "none";
    document.getElementById("scrollbar").style.display = "none";
    document.getElementById("fixedAxes").style.display = "none";
    document.getElementById("combineCharts").style.display = "none";
    document.getElementById("export").style.display = "none";


    document.getElementById("axesValues").style.display = "block";
    document.getElementById("fixedAxes").innerHTML = "Free axes";
    axesFixed = true;

  }
  else if (axesFixed == true) {
    document.getElementById("fixedAxes").innerHTML = " Fix axes";

    axesFixed = false;
    am5ready();
  }
}

function submitAxesSettings() {
  let tUpper = document.getElementById("tempUpper").value;
  let tLower = document.getElementById("tempLower").value;
  let hUpper = document.getElementById("humUpper").value;
  let hLower = document.getElementById("humLower").value;
  tempUpper = parseInt(tUpper);
  tempLower = parseInt(tLower);
  humUpper = parseInt(hUpper);
  humLower = parseInt(hLower);
  document.getElementById("terminal").innerHTML += tempUpper;
  document.getElementById("terminal").innerHTML += tempLower;
  document.getElementById("terminal").innerHTML += humUpper;
  document.getElementById("terminal").innerHTML += humLower;

  document.getElementById("axesValues").style.display = "none";
  document.getElementById("visualize").style.display = "block";
  document.getElementById("scrollbar").style.display = "block";
  document.getElementById("fixedAxes").style.display = "block";
  document.getElementById("combineCharts").style.display = "block";
  document.getElementById("export").style.display = "block";

  axesFixed = true;
  am5ready();
}

function scrollbar() {
  if (scrollBar == false) {
    document.getElementById("scrollbar").innerHTML = "Remove scrollbar";
    scrollBar = true;
  }
  else if (scrollBar == true) {
    document.getElementById("scrollbar").innerHTML = "Add scrollbar";

    scrollBar = false;
  }
  am5ready();
}

function multipleCharts() {
  if (chartsCombined == false) {
    document.getElementById("combineCharts").innerHTML = "Seperate Charts";

    document.getElementById("chartdiv2").style.display = "none";
    document.getElementById("chartdiv3").style.display = "none";
    document.getElementById("chartdiv4").style.display = "none";
    document.getElementById("chartdiv5").style.display = "none";
    document.getElementById("chartdiv1").style.height = "40vw";
    chartsCombined = true;
  }
  else {
    document.getElementById("combineCharts").innerHTML = "Combine Charts";

    document.getElementById("chartdiv2").style.display = "block";
    document.getElementById("chartdiv3").style.display = "block";
    document.getElementById("chartdiv4").style.display = "block";
    document.getElementById("chartdiv5").style.display = "block";
    document.getElementById("chartdiv1").style.height = "20vw";


    chartsCombined = false;
  }
  am5ready();
}

function exportSettings() {
  document.getElementById("export").style.display = "none";
  document.getElementById("visualize").style.display = "none";
  document.getElementById("scrollbar").style.display = "none";
  document.getElementById("fixedAxes").style.display = "none";
  document.getElementById("combineCharts").style.display = "none";
  document.getElementById("exportSettings").style.display = "block";
}

function safeExportSettings() {
  if (document.getElementById("fileName").value == "") {
    window.alert("You need to choose a name for the export-file.");
  }
  else {
    filename = document.getElementById("fileName").value;
    am5ready();
    document.getElementById("exportSettings").style.display = "none";
    document.getElementById("export").style.display = "block";
    document.getElementById("visualize").style.display = "block";
    document.getElementById("scrollbar").style.display = "block";
    document.getElementById("fixedAxes").style.display = "block";
    document.getElementById("combineCharts").style.display = "block";
  }
}


function dashboard() {
  document.getElementById("chartSettings").style.display = "none";
  document.getElementById("measurementSettings").style.display = "block";

}

// this function creates a chart with specific attributes
// as the values it used the measurments stored in gobal variables
// it is called in the function measurementFinished()
function am5ready() {

  function createChart(div, addressPos) {
    // checks if root object already exists. If so it will be deleted so a new chat with correct values can be
    if (globalRootObject[addressPos]) {
      globalRootObject[addressPos].dispose();
    }
    // Create root element
    let root = am5.Root.new(div);
    globalRootObject[addressPos] = root;
    // Set themes
    root.setThemes([
      am5themes_Animated.new(root)
    ]);
    // Create chart
    let chart = root.container.children.push(
      am5xy.XYChart.new(root, {
        layout: root.verticalLayout,
        focusable: true,
        panX: true,
        panY: true,
        wheelX: "panX",
        wheelY: "zoomX",
        pinchZoomX: true
      })
    );

    // different colors for individual series
    chart.get("colors").set("step", 8);

    if (chartsCombined == false) {
      let preTitle = "Sensor Address: "
      let sensor = preTitle.concat(addressBytes[addressPos].toString(16));
      chart.children.unshift(am5.Label.new(root, {
        text: sensor,
        fontSize: 25,
        fontWeight: "300",
        textAlign: "center",
        x: am5.percent(50),
        centerX: am5.percent(50),
        paddingTop: 0,
        paddingBottom: 0
      }));
    }

    // Create axes
    let xAxis = chart.xAxes.push(
      am5xy.DateAxis.new(root, {
        maxDeviation: 0.1,
        groupData: false,
        baseInterval: {
          timeUnit: "second", //"second"
          count: 1
        },

        // renderer displays objects on the screen
        renderer: am5xy.AxisRendererX.new(root, {}),
        tooltip: am5.Tooltip.new(root, {})

      })
    );

    var yRendererH = am5xy.AxisRendererY.new(root, {
      opposite: true
    });
    var yRendererT = am5xy.AxisRendererY.new(root, {
      opposite: false
    });


    if (axesFixed) {
      var yAxisH = chart.yAxes.push(
        am5xy.ValueAxis.new(root, {
          maxDeviation: 1,
          renderer: yRendererH,
          // comment out the next two lines if you rather have variable axis ranges
          min: humLower,
          max: humUpper,
        })
      );
      var yAxisT = chart.yAxes.push(
        am5xy.ValueAxis.new(root, {
          maxDeviation: 1,
          renderer: yRendererT,
          // comment out the next two lines if you rather have variable axis ranges
          min: tempLower,
          max: tempUpper,
        })
      );
    }
    else {
      var yAxisH = chart.yAxes.push(
        am5xy.ValueAxis.new(root, {
          maxDeviation: 1,
          renderer: yRendererH,
          // comment out the next two lines if you rather have variable axis ranges
          //min: 0,
          //max: 100,
        })
      );
      var yAxisT = chart.yAxes.push(
        am5xy.ValueAxis.new(root, {
          maxDeviation: 1,
          renderer: yRendererT,
          // comment out the next two lines if you rather have variable axis ranges
          //min: 0,
          //max: 50,
        })
      );
    }



    // yAxis.children.push() creates the label as the last element
    // in case of the Humidity the label needs to be last element because the axis is on the right side of the graph
    yAxisH.children.push(
      am5.Label.new(root, {
        rotation: -90,
        text: "Humidity",
        y: am5.p50,
        centerX: am5.p50
      })
    );
    // yAxis.children.unshift() creates the label as first element
    yAxisT.children.unshift(
      am5.Label.new(root, {
        rotation: -90,
        text: "Temperature",
        y: am5.p50,
        centerX: am5.p50
      })
    );

    // color spectrum for different series, when combined in one chart
    let colorsTemp = [0xff0000, 0xff7000, 0xffb900, 0xffe000, 0xffff00];
    let colorsHum = [0x0004ff, 0x0080ff, 0x00c9ff, 0x00ffdc, 0x00ff9e];

    // Add series
    // individual charts for each sensor
    // the function createChart is called several times with two series for each chart
    if (chartsCombined == false) {
      humSeries[addressPos] = chart.series.push(
        am5xy.LineSeries.new(root, {
          xAxis: xAxis,
          yAxis: yAxisH,
          valueYField: "value",
          valueXField: "date",
          tooltip: am5.Tooltip.new(root, {
            pointerOrientation: "horizontal",
            labelText: "{valueY}"
          })
        })
      );
      tempSeries[addressPos] = chart.series.push(
        am5xy.LineSeries.new(root, {
          xAxis: xAxis,
          yAxis: yAxisT,
          valueYField: "value",
          valueXField: "date",
          tooltip: am5.Tooltip.new(root, {
            pointerOrientation: "horizontal",
            labelText: "{valueY}"
          })
        })
      );

      // set the thickness of the lines
      humSeries[addressPos].strokes.template.setAll({ strokeWidth: 2 });
      tempSeries[addressPos].strokes.template.setAll({ strokeWidth: 2 });

      // set grid thickness
      yRendererH.grid.template.set("strokeOpacity", 0.1);
      yRendererH.labels.template.set("fill", humSeries[addressPos].get("fill"));
      yRendererH.setAll({
        stroke: humSeries[addressPos].get("fill"),
        strokeOpacity: 1,
        opacity: 1
      });
      yRendererT.grid.template.set("strokeOpacity", 0.1);
      yRendererT.labels.template.set("fill", tempSeries[addressPos].get("fill"));
      yRendererT.setAll({
        stroke: tempSeries[addressPos].get("fill"),
        strokeOpacity: 1,
        opacity: 1
      });

      // Set up data processor to parse string dates
      humSeries[addressPos].data.processor = am5.DataProcessor.new(root, {
        dateFields: ["date"]
      });
      tempSeries[addressPos].data.processor = am5.DataProcessor.new(root, {
        dateFields: ["date"]
      });

      humSeries[addressPos].set("stroke", am5.color(colorsHum[0]));
      humSeries[addressPos].set("fill", am5.color(colorsHum[0]));

      tempSeries[addressPos].set("stroke", am5.color(colorsTemp[0]));
      tempSeries[addressPos].set("fill", am5.color(colorsTemp[0]));

      humSeries[addressPos].data.setAll(correctHumValues[addressPos]);
      tempSeries[addressPos].data.setAll(correctTempValues[addressPos]);
    }
    // one chart for all sensors
    // the function createChart is called once with 2 series * the amount of sensors connected
    else if (chartsCombined == true) {
      let tempName = "Temperature ";
      let humName = "Humidity ";

      let seriesNameTemp = [];
      let seriesNameHum = [];

      let legend = chart.children.push(am5.Legend.new(root, {
        nameField: "name",
        fillField: "color",
        strokeField: "color",
        centerX: am5.percent(50),
        x: am5.percent(50)
      }));

      for (let i = 0; i < addressBytes.length; i++) {
        humSeries[i] = chart.series.push(
          am5xy.LineSeries.new(root, {
            name: addressBytes[i],
            xAxis: xAxis,
            yAxis: yAxisH,
            valueYField: "value",
            valueXField: "date",
            tooltip: am5.Tooltip.new(root, {
              pointerOrientation: "horizontal",
              labelText: "Id:{name}, {id}: {valueY}%"
            })
          })
        );
        tempSeries[i] = chart.series.push(
          am5xy.LineSeries.new(root, {
            name: addressBytes[i],
            xAxis: xAxis,
            yAxis: yAxisT,
            valueYField: "value",
            valueXField: "date",
            tooltip: am5.Tooltip.new(root, {
              pointerOrientation: "horizontal",
              labelText: "Id:{name}, {valueY}°C"
            })
          })
        );
        // set the thickness of the lines
        humSeries[i].strokes.template.setAll({ strokeWidth: 2 });
        tempSeries[i].strokes.template.setAll({ strokeWidth: 2 });

        // set grid thickness
        yRendererH.grid.template.set("strokeOpacity", 0.1);
        yRendererH.labels.template.set("fill", humSeries[i].get("fill"));
        yRendererH.setAll({
          stroke: humSeries[i].get("fill"),
          strokeOpacity: 1,
          opacity: 1
        });
        yRendererT.grid.template.set("strokeOpacity", 0.1);
        yRendererT.labels.template.set("fill", tempSeries[i].get("fill"));
        yRendererT.setAll({
          stroke: tempSeries[i].get("fill"),
          strokeOpacity: 1,
          opacity: 1
        });

        // Set up data processor to parse string dates
        humSeries[i].data.processor = am5.DataProcessor.new(root, {
          dateFields: ["date"]
        });
        tempSeries[i].data.processor = am5.DataProcessor.new(root, {
          dateFields: ["date"]
        });

        humSeries[i].set("stroke", am5.color(colorsHum[i]));
        humSeries[i].set("fill", am5.color(colorsHum[i]));

        tempSeries[i].set("stroke", am5.color(colorsTemp[i]));
        tempSeries[i].set("fill", am5.color(colorsTemp[i]));


        humSeries[i].data.setAll(correctHumValues[i]);
        tempSeries[i].data.setAll(correctTempValues[i]);

        legend.data.setAll(humSeries[i].dataItems);
        legend.data.setAll(tempSeries[i].dataItems);

        seriesNameTemp[i] = tempName.concat(addressBytes[i].toString());
        seriesNameHum[i] = humName.concat(addressBytes[i].toString());

      }

      legend.data.setAll([
        {
          name: seriesNameHum[0],
          color: am5.color(colorsHum[0])
        },
        {
          name: seriesNameHum[1],
          color: am5.color(colorsHum[1])
        },
        {
          name: seriesNameHum[2],
          color: am5.color(colorsHum[2])
        },
        {
          name: seriesNameHum[3],
          color: am5.color(colorsHum[3])
        },
        {
          name: seriesNameHum[4],
          color: am5.color(colorsHum[4])
        },
        {
          name: seriesNameTemp[0],
          color: am5.color(colorsTemp[0])
        },
        {
          name: seriesNameTemp[1],
          color: am5.color(colorsTemp[1])
        },
        {
          name: seriesNameTemp[2],
          color: am5.color(colorsTemp[2])
        },
        {
          name: seriesNameTemp[3],
          color: am5.color(colorsTemp[3])
        },
        {
          name: seriesNameTemp[4],
          color: am5.color(colorsTemp[4])
        },

      ]);


    }


    // Add cursor
    var cursor = chart.set("cursor", am5xy.XYCursor.new(root, {
      xAxis: xAxis,
      behavior: "none"
    }));
    cursor.lineY.set("visible", false);

    // add scrollbar
    var scrollbarX = am5xy.XYChartScrollbar.new(root, {
      orientation: "horizontal",
      height: 10
    });


    if (scrollBar) {
      // assign it and place it on the charts bottom
      chart.set("scrollbarX", scrollbarX);
      chart.bottomAxesContainer.children.push(scrollbarX);
    }

    var exporting = am5plugins_exporting.Exporting.new(root, {
      menu: am5plugins_exporting.ExportingMenu.new(root, {}),
      filePrefix: filename,
      dataSource: exportData,
      dateFields: ["date"],
      dateFormat: "HH:mm:ss",
      pngOptions: {
        quality: 1,
        maintainPixelRatio: true
      },
      jpgOptions: {
        quality: 1
      },
      xlsxOptions: {
        addColumnNames: true,
        emptyAs: ""
      },
      csvOptions: {
        addColumnNames: true,
        addBOM: true,
        emptyAs: ""
      },
      pdfdataOptions: {
        addColumnNames: true,
        emptyAs: ""
      },
      pdfOptions: {
        addURL: false,
        includeData: true,
        quality: 1
      }
    });


    // Make stuff animate on load
    chart.appear(1000, 100);
  }
  let charts = ["chartdiv1", "chartdiv2", "chartdiv3", "chartdiv4", "chartdiv5"];
  if (chartsCombined == true) {
    createChart("chartdiv1", 0)
  }
  else {
    for (let i = 0; i < addressBytes.length; i++) {
      createChart(charts[i], i);
    }
  }
}

// this function adds the latest objects of the data arrays to the series of the chart. 
// It is called in the function safeData() whenever a new value is added to the array
function liveData(measurementValue, axisSeries) {
  let size = measurementValue.length;
  let newestValue = measurementValue[size - 1];

  axisSeries.data.push(newestValue);

}



