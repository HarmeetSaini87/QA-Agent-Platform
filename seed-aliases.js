const http = require('http');

const aliases = {
  "Click User Name": ["username field","user name input","username box","login username","user name textbox","username entry","user name field","username input box","enter username","user name label","username column","user field","login user","user text field","user name area"],
  "Click Password": ["password field","password input","password box","login password","password textbox","pass field","password entry","enter password","pwd input","password area","credential password","login pwd","secret field","pass textbox","password column"],
  "Click Login": ["login button","sign in button","submit login","log in","login btn","authenticate button","enter button","signin","log in button","login action","submit credentials","login submit","sign in","access button","confirm login"],
  "Click Save": ["save button","submit button","confirm button","save changes","save record","apply button","save form","confirm save","ok button","update button","commit button","save entry","store button","save action","submit changes"],
  "Click Gateway Type Configuration": ["gateway type menu","gateway type config","gateway type link","gateway configuration","gateway type nav","gateway type tab","gateway config menu","gateway type section","gateway settings","gateway type option","gateway type page","gateway type item","gateway type entry","gateway type route","gateway setup"],
  "Click GateWayType": ["gateway type field","gateway name input","gateway type textbox","type gateway name","gateway name field","gateway type dropdown","gateway type entry","gateway type input","gateway type select","gateway type box","gateway name entry","gateway type area","gateway type column","gateway name textbox","gateway type value"],
  "Click M211p": ["menu icon","navigation icon","sidebar icon","hamburger menu icon","nav icon","expand menu icon","menu toggle icon","side menu icon","menu button icon","drawer icon","menu opener","collapse icon","panel icon","drawer toggle","navigation menu"],
  "Click M212p": ["info icon","information icon","details icon","tooltip icon","help icon","info button icon","info toggle","information toggle","more info icon","info link icon","detail icon","about icon","question icon","info action icon","tooltip button"],
  "Click M223p": ["section icon","panel icon","expand section icon","toggle icon","section toggle","expand icon","collapse section","accordion icon","section menu icon","expand menu icon","group icon","category icon","section opener","drawer icon","panel toggle"],
  "Click Enrichment Rule": ["enrichment rule menu","enrichment rule link","enrichment rule tab","enrichment rule nav","enrichment config","enrichment rule section","enrichment settings","rule configuration","enrichment page","enrichment rule option","enrichment setup","enrichment menu","rule menu","data enrichment link","enrichment entry"],
  "Click BtnCreate": ["create button","add button","plus button","new button","add new","create new button","create record","new entry button","add record","new item button","create action","add item","insert button","new entry","add new button"],
  "Click Distributor": ["distributor field","distributor dropdown","distributor select","distributor input","distributor choice","distributor list","distributor menu","distributor option","select distributor","distributor entry","distributor column","distributor box","distributor picker","distributor value","distributor combo"],
  "Click Down Stream": ["down stream menu","downstream link","down stream nav","down stream tab","downstream configuration","down stream section","downstream settings","down stream option","downstream entry","down stream page","downstream route","down stream setup","downstream config link","down stream item","down stream navigation"],
  "Click ServerName": ["server name field","server name input","server name textbox","server name box","server name entry","server input","server field","hostname field","server name area","enter server name","server name column","server name text","server name dropdown","server configuration name","server name select"],
  "Click MstDownStreamID": ["downstream id field","downstream id dropdown","downstream id select","downstream id input","downstream id box","mst downstream id","downstream id entry","downstream id choice","select downstream id","downstream id column","downstream id picker","downstream identification","downstream id combo","downstream id value","downstream id option"],
  "MessageAlert": ["alert message","error message","warning message","alert notification","error alert","error banner","warning banner","alert toast","error toast","validation error","error notification","alert popup","danger message","error display","alert text"],
  "MessageSuccess": ["success message","success notification","success banner","success toast","success alert","confirmation message","success popup","done message","completed message","ok message","success display","success text","operation successful","saved successfully","success feedback"],
  "GateWayTypeErrorMsg": ["gateway type error","gateway error message","gateway validation error","gateway type alert","gateway error text","gateway type validation","gateway form error","gateway type warning","gateway field error","gateway error display","gateway type invalid","gateway error notification","gateway error banner","gateway type error message","gateway validation message"],
  "GateWayTypeGrid_info": ["gateway type grid","gateway grid info","gateway type table","gateway type list","gateway data grid","gateway type data","gateway type details","gateway grid view","gateway type overview","gateway type records","gateway type entries","gateway type summary","gateway type information","gateway type listing","gateway type display"],
  "Click Audit_XML": ["audit xml link","audit xml menu","audit xml tab","audit xml nav","xml audit","audit xml row","audit xml option","audit xml entry","audit xml section","audit xml action","xml audit link","audit trail xml","audit file link","audit xml button","audit xml navigation"],
  "Click Yes": ["yes button","confirm yes","agree button","accept button","positive button","yes option","yes choice","approve button","yes confirm","proceed button","acknowledge button","yes action","accept yes","yes click","ok yes button"],
  "Click Cancel": ["cancel button","close button","dismiss button","abort button","discard button","reject button","cancel action","cancel option","cancel link","go back button","never mind button","cancel choice","stop button","cancel close","no button"],
  "Click Upload": ["upload button","file upload button","upload file","attach file button","upload action","upload link","upload trigger","import button","upload document","upload file button","browse and upload","send file","upload document button","upload choice","upload entry"]
};

const data = JSON.stringify(aliases);

// Use API key auth instead of session
const apiKey = 'qa-platform-admin-key-2025';

const putReq = http.request({ hostname: 'localhost', port: 3003, path: '/api/nl/aliases', method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey, 'Content-Length': Buffer.byteLength(data) } }, (res) => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => { console.log('Status:', res.statusCode, 'Body:', body); });
});
putReq.write(data);
putReq.end();