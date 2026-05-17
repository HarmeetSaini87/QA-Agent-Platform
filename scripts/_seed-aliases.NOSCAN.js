'use strict';
/**
 * SEED SCRIPT — run manually only.
 * Default: MERGE hardcoded entries into existing nl-locator-aliases.json (preserves UI-added entries).
 * --force flag: full overwrite (destroys UI-added entries — use only on fresh install).
 */
const fs   = require('fs');
const path = require('path');

const FORCE = process.argv.includes('--force');
if (FORCE) {
  console.warn('WARNING: --force mode — existing aliases will be overwritten.');
} else {
  console.log('MERGE mode — existing aliases preserved. Pass --force to overwrite.');
}

const DATA_DIR = path.resolve(__dirname, '..', 'data');

const aliases = {
  '63b6f9bc-053e-45ef-9e6c-383f3ac956ce': ['gender field','gender dropdown','select gender','gender input','patient gender','gender selector','gender option','choose gender','gender picker','gender selection'],
  'c15ff511-f25e-4fca-a719-dbb48d7d24bf': ['yes button','confirm yes','click yes','yes confirmation','yes dialog button','confirm action','yes prompt','accept yes','yes popup button','affirmative button'],
  '13c4edcf-2721-4fde-ad99-f3fd8b7908a2': ['save gateway','gateway save button','save gateway config','save gateway settings','submit gateway','gateway form save','save gateway entry','confirm gateway save','persist gateway','gateway save'],
  'bded913c-574e-44b6-9103-0621f1b5662c': ['add step button','new step','add step','plus add step','create step','insert step','add flow step','step add button','add new step','append step'],
  'a84a88be-400e-4b46-9e12-cede24c5e612': ['cancel script editor','script editor cancel','cancel in overlay','dismiss script editor','cancel button overlay','close script editor','abort script edit','script cancel','editor cancel button','cancel overlay action'],
  '1a4294f2-e5ff-4d84-89f0-b9564d5873f7': ['new script button','create new script','add script','new script','script create button','start new script','new script action','open new script','create script','btn new script'],
  '4dabcdf0-bb1b-4f0b-87ff-90e03a931d2a': ['save gateway type','gateway type save','save gateway type config','submit gateway type','gateway type form save','confirm gateway type save','persist gateway type','save type settings','gateway type submit','gateway type save button'],
  'cbab71dd-089a-4f7a-9224-8af7ce18a807': ['username label','user name label','click username label','username field label','login username label','user label click','username form label','user name click','label for username','username label click'],
  '76a395f6-f99e-4421-970f-2420965858ad': ['audit xml link','click audit xml','audit xml row link','audit xml table link','audit xml entry','open audit xml','audit xml record','audit xml action link','select audit xml','audit xml item'],
  '91458c41-b7a2-4257-845d-4698ab3e9898': ['browse button','file browse','click browse','browse popup','open file browser','browse label','file picker browse','browse in popup','open browse dialog','browse file label'],
  '294902ec-d4e3-4766-b1ae-e2ccd7b6aee1': ['file upload label','select file label','upload file label','choose file label','file input label','upload placeholder label','select file to upload','file label upload','upload file picker label','choose file input'],
  'd4a8f6be-f65a-4486-a09a-b7746352f8df': ['upload button','click upload','submit upload','file upload button','upload span button','trigger upload','upload action','upload file button','upload submit','file upload click'],
  'aa68fbd8-465b-4638-b884-05847163d851': ['distributor id field','distributor id input','select distributor','distributor field','distributor id dropdown','distributor identifier','distributor id selector','click distributor id','distributor id','distributorID'],
  '56170489-6eb5-483f-96d6-3bd6810ffcc6': ['save button','click save','submit form','save action','save record','save entry','form save','save span button','confirm save','persist changes'],
  '35bdc8ef-55d3-439d-8598-3208cdb629c4': ['save gateway type span','gateway type save span','click save gateway type','submit gateway type span','gateway type form submit','save type button span','save type action','persist gateway type span','gateway type span save','save type span'],
  '9b88bd0b-3bd4-4176-85d2-0ac426a3086e': ['ascii popup close','close ascii popup','ascii popup icon','dismiss ascii popup','ascii popup x button','close ascii dialog','ascii modal close','ascii popup collapse','ascii close icon','exit ascii popup'],
  '39974ab3-abe4-4e81-ae23-1beb05bc2270': ['downstream node','click downstream','downstream connection','downstream element','select downstream','downstream link','downstream button','downstream canvas node','open downstream','m219p212 node'],
  'abf43837-413e-4ead-b27a-6ea836833c32': ['master downstream id','downstream id field','mst downstream dropdown','downstream id selector','downstream id input','select downstream id','master downstream selector','downstream id field click','master downstream input','MstDownStreamID'],
  'e3d6fece-cb2d-4fe3-a1e8-969c7440d7a4': ['server name field','server name input','server name textbox','enter server name','ftp server name','server name click','type server name','server name form field','server hostname field','ServerName'],
  '1e4e7ce9-6863-4652-b653-8a425e5026da': ['save ftp','ftp save button','save ftp config','submit ftp form','ftp form save','save ftp settings','confirm ftp save','persist ftp','ftp submit button','btnSaveFTP'],
  '04c5aa09-c9e2-4ce3-9e1c-f8410aebd077': ['username input','user name input','username field','login username input','enter username','type username','username textbox','user id input','login user field','username entry'],
  '38eb882d-e05d-4ef5-97f7-9e7f9924c7a2': ['password input','fill password','password field','enter password','type password','password textbox','login password','password entry','password form field','credentials password'],
  '4c0d83ed-cc2f-4f50-860c-ae2c5eae9095': ['login button','click login','submit login','sign in button','login action','login span','login submit','login form button','authenticate','click sign in'],
  'fdd2acae-bd34-40a8-8d55-de28e7b88438': ['m212p icon','click m212p','m212p node icon','extract layer icon','m212p element','click m212p icon','m212p first icon','node m212p icon','m212p button icon','open m212p'],
  'f28075fc-9c24-452e-a744-6c79385395a5': ['gateway type configuration','click gateway type config','gateway type config node','open gateway type config','gateway type configuration link','gateway type setup','gateway type config item','navigate gateway type config','gateway config type','m213p212'],
  'c9f7a3ba-5262-458f-9096-1f9f6c77aff7': ['create button','btn create','click create','create action icon','new item create','create record button','create icon button','initiate create','add via create button','create entry'],
  'd0005cd6-67de-4192-bb11-df7969e1a438': ['gateway type field','gateway type input','select gateway type','gateway type textbox','gateway type entry','type gateway type','gateway type form field','gateway type identifier','gateway type value','GateWayType'],
  '7d8a1cee-112a-4117-9386-830be15be05e': ['save span nth','save button nth','save action nth','click save span','save button zero','first save span','save label nth','save span button','nth save button','save nth element'],
  '55b6aa18-1287-418c-b16e-c4302b7619f6': ['login button id','btnLogin','click login button','login submit button','login btn','submit credentials','login button click','login action button','sign in btn','authenticate button'],
  '46bf6dad-a424-4ca2-8fc1-94e66145fd72': ['gateway type text field','txtGateWayType','gateway type text input','gateway type name input','type gateway type name','gateway type text box','enter gateway type','gateway type text entry','gateway type label input','gateway type field input'],
  '50c8ff87-e896-482d-aff2-82716f6d0707': ['search field','search input','search box','click search','search bar','search textbox','search entry','search button','enter search','type search'],
  '9565871e-ab4d-4e83-b43b-e228f7c15811': ['gateway configuration','click gateway config','gateway config node','open gateway configuration','gateway config link','gateway config item','navigate gateway config','gateway configuration menu','gateway config page','m215p212'],
  'f33e09fd-91ea-4647-8462-0f598e7e7be9': ['gateway type dropdown','select gateway type dropdown','gateway type select','gateway type combo','gateway type list','choose gateway type','gateway type option','gateway type picker','drpgatewaytype','gateway type drp'],
  '64a44a81-f4e0-4a43-aab1-8a3b6151f8a5': ['username label link','label for username','click username label','login username label click','username form label','user name label element','label username field','click user name label','username label selector','user name label for'],
  '89baeb90-861d-45a8-a448-9e8299c04eff': ['username field','click username','user name input click','login user name','username id field','username field click','user name click','enter username field','username form input','username element'],
  '3cc55e6b-2571-4f2c-a1c0-dfd62e38aff4': ['password field','click password','password input click','login password field','password element','enter password field','password click','type password field','password id field','password form field'],
  'f1e37502-e907-4c24-9d31-3b64c22b6558': ['login button','click login','login btn click','login form submit','submit login form','login button action','login button id','login submit','authenticate user','btnLogin submit'],
  '3ebf3d69-3d25-4024-91be-c548167500b0': ['reconciliation tools menu','click reconciliation tools','reconciliation tools nav','recon tools link','open reconciliation tools','navigate reconciliation tools','recon tools menu item','reconciliation tools click','recon tools navigation','reconciliation tools span'],
  '793f0767-5916-4dea-a63b-4d8962f629fd': ['recon flow builder','click recon flow builder','open recon flow builder','recon flow builder menu','navigate recon flow builder','flow builder link','recon builder menu item','go to flow builder','recon flow builder nav','m249p98'],
  '590c1cc3-50a8-4fde-a177-d7355cc592b8': ['recon flow list grid','hover recon flow list','recon flow grid hover','recon flow list hover','hover flow list grid','recon list grid hover','flow list grid element','reconciliation flow list','hover recon list','reconFlowListGrid'],
  'c127d221-d593-4268-95b9-d01970cf4367': ['add button hover','hover add','hover create flow button','hover new flow','hover add flow','hover create button','hover flow add button','hover add flow builder','createFlowBuilderBtn hover','create flow builder btn hover'],
  '350d838e-81fe-4d67-a141-23db9cc05410': ['create flow builder button','click create flow','flow builder create icon','add new flow','create flow button','new flow builder','flow create button','initiate flow builder','click new flow','createFlowBuilderBtn click'],
  '5ee3aa20-ed0a-4f10-b8fa-5c524cfdb12c': ['back button','click back','btnBack','go back','navigate back','back action','return button','back navigation','previous page','back btn'],
  '1e2204b8-9123-43fa-926e-1adf25be8f0a': ['back button role','click back button','back role button','back navigation button','return back','go back button','back action button','back role','navigate back button','role back'],
  '3d6ec196-8d03-4d7f-81d4-ef48341bb5cc': ['save config dialog','assert save dialog','do you want to save','save configuration confirmation','dialog body assert','save config prompt','configuration save dialog','assert dialog text','save prompt body','verify save dialog'],
  'a2044cc1-1424-4a7e-b895-003f0a1378e2': ['description field','description input','click description','description textbox','enter description','description id field','type description','description form field','description entry','description box'],
  '0ee4a74f-342c-4f39-8da3-ee115b87af88': ['description textarea','flow description','description text area','start form description','enter flow description','description textarea input','flow description field','description editor','description textarea box','fill description'],
  '14366752-708a-4fcc-9ab5-f78a7741a8b2': ['hover gateway type grid','gateway type grid hover','hover gateway type table','gateway type table hover','hover gateway grid header','gateway type list hover','hover gateway type list','gateway type grid element','hover grid gateway type','GateWayTypeGrid hover'],
  '84ce4fd2-8d23-47d0-a4d3-e3529a11b4f7': ['hover add button','hover create button','hover new item','hover add record','hover create action','hover plus button','hover create icon','hover add icon','add button hover','btnCreate hover'],
  '314f90c1-711e-48b5-b449-6fa329a9d318': ['save gateway type id','click save gateway type','submit gateway type id','gateway type save id','persist gateway type button','confirm gateway type','gateway type id save','save type via id','btnSaveGateWayType click','save gateway type button'],
  'fb0b7712-8e3f-404a-a62c-0d2bc7748a2e': ['hover search link','hover search button','search link hover','hover search anchor','search hover action','hover search icon','hover search title','search title hover','hover search element','search anchor hover'],
  'b178b513-a5bb-4a41-a3cf-d5039d8005fd': ['password label','click password label','label for password','password field label','login password label','password label click','password form label','label password element','click password field label','password label selector'],
  '95239f5a-d51d-429e-b57d-db0a1a2718a9': ['gateway name field','enter gateway name','gateway name textbox','type gateway name','gateway name entry','gateway name id field','gateway name form field','gateway name input click','gateway name selector','GatewayName input'],
  '0b73d544-47b5-4e5f-9938-daf0d45dbeb1': ['skip parser header toggle','skip header flag','parser header skip label','toggle skip header','skip header checkbox label','enable skip header','parser header flag label','skip header option','header skip flag label','FlgSkipParserHeader label'],
  'bf4ee42b-13a8-4f36-9bd6-3bfe5dfb532a': ['enable flag label','enable toggle','enable checkbox label','flg enable label','enable option label','toggle enable','enable switch label','activation flag label','enable field label','FlgEnable label'],
  'a951678f-ff76-45fe-a928-ad9faa303b44': ['alert no file flag','alert no file label','no file alert toggle','alert no file checkbox','alert when no file label','no file alert flag','enable alert no file','no file flag label','FlgAlertNoFile label','flg alert no file'],
  'cb10fed9-4c0b-48d7-a5cd-46fa3468bf17': ['alert interval field','enter alert interval','alert interval textbox','alert interval value','type alert interval','alert interval entry','alert interval id','alert interval form field','set alert interval','AlertInterval input'],
  '92f33bb4-4a28-4207-8f3e-98905d534b6f': ['super admin user link','hover super admin','super admin user hover','admin user link hover','superadmin hover','hover admin user','super admin nav hover','admin user menu hover','hover superadmin link','super admin link hover'],
  '5a19c137-a04c-443f-9173-8264e6a4dce2': ['super admin user','click super admin','admin user span','superadmin click','select super admin','admin user title','click admin user','super admin nav','admin menu click','super admin title span'],
  '789f2f0c-e1d6-49af-9a85-67edfb8ad0bf': ['hover search anchor','hover search link','search hover','hover search element','search link hover','hover search title attr','search anchor hover','hover search action','hover search icon link','hover search a'],
  'b3e779d8-2137-4523-99e3-4c7a760187ff': ['reconciliation tools','click recon tools','recon tools nav','open recon tools','recon tools click','navigate recon','recon module','recon tools id click','m98p menu','reconciliation tools id'],
  '0924bf42-b88d-41ba-baf3-3fb92f352f04': ['column setting hover','hover column settings','column settings hover','hover column setting anchor','column setting icon hover','hover column config','column configuration hover','hover table column setting','grid column setting hover','hover column setting link'],
  '9dbf9397-adf7-4c65-8aaf-74a39bb6965a': ['cancel button role','click cancel','cancel action','role cancel button','dismiss dialog','cancel button','abort action','cancel form','close dialog','cancel role button'],
  'f958d3a6-3da0-4310-956f-c72424a5c95e': ['hover logout','logout hover','hover logout menu','logout link hover','hover logout item','logout nav hover','hover sign out','logout list item hover','hover exit','logout element hover'],
  'aba32699-1496-4cb9-b62c-4c8654e7b918': ['logout link','click logout','sign out','logout action','logout button','link logout','navigate logout','click sign out','logout click','exit application'],
  '395796c9-73dd-463c-ad0d-8cec220ddb9f': ['reoccurrence radio','click reoccurrence','reoccurrence label','recurrence toggle','recurrence radio button','enable reoccurrence','select reoccurrence','reoccurrence option','recurrence flag','rbRecorrence label'],
  '901aa8cb-2a3d-408e-a25d-58b723689109': ['disable option','click disable','disable label','disable toggle','disable radio','select disable','disable option label','disable flag','disable action','Disable-lab'],
  '6d8ef7a3-683f-4b22-a884-9e1e7337e8cf': ['look back range','look back range field','enter look back range','look back period','look back range textbox','set look back range','look back range value','look back range entry','lookbackrange field','LookBackRange input'],
  '2802eaca-827a-423e-a28e-2221deb1da72': ['execution type','flow execution collector','execution type dropdown','collector loader type','flow execution type','select execution type','flow collector loader','execution type select','collector loader dropdown','executionType field'],
  '0c580639-3040-4759-86fc-519a0964efb3': ['expand button hover','hover expand','hover flow card expand','expand card hover','hover expand button','flow card expand hover','hover expand icon','expand panel hover','hover expand action','card expand hover'],
  '2a2c9965-07c7-45a0-8003-70ccf1fd52b2': ['enter flow name','flow name input','flow name field','type flow name','flow name placeholder','search flow name input','flow name search','enter name input','flow name textbox','flow name entry'],
  'defad136-fafa-4e23-a6de-f1756f5645d8': ['drag svg chart','drag average execution time','drag drop flow chart','drag recon chart svg','flow chart drag','drag svg element','drag execution time chart','chart drag drop','svg drag action','drag flow visualization'],
  'cc733cfc-3b8e-4871-b3b4-941fb3baaf57': ['hover clone','clone row hover','hover clone link','hover clone action','table row clone hover','hover duplicate','clone record hover','hover clone icon','hover copy record','clone element hover'],
  '2f431488-69ef-4627-aa70-b2324ebc9911': ['month dropdown','select month','month combobox','month picker','choose month','month selector','month selection','month combo','pick month','month option combobox'],
  '85dae5de-4058-413f-b396-12ef4215c48b': ['month field id','month input','month selector id','click month field','month id input','select month id','month dropdown id','month field click','month element id','month picker id'],
  'df39633a-6f0f-4a96-a089-baa12577818f': ['date field','click date','date selector','date picker field','date input id','select date','date entry','date form field','date id field','Date input'],
  '3e7917e9-a056-48d5-a9a3-de287c3eddf1': ['hour field','click hour','hour selector','hour picker','hour entry','hour input id','select hour','hour form field','hour dropdown','Hour input'],
  '1c0539bc-22ff-4ea0-a3db-9886359fa7c3': ['save button id','click save','btnSave','save record','submit form save','save action id','save form','confirm save','persist record','save btnSave'],
  '87beabb9-4860-4a09-804e-4603b9adb1a4': ['save button role','click save role','save role button','save action role','submit save','save button','confirm save role','save form role','role save button','save button via role'],
  '47ca5b0b-592c-48d5-afb7-260103fda3b7': ['user id input','enter user id','user id field','user id placeholder','user id textbox','login user id','type user id','user id entry','user id form field','user id search'],
  '89a02286-d205-4802-873d-aa807db10657': ['password placeholder','fill password','password input','enter password','type password','password field','password entry','login password input','password textbox placeholder','credentials password field'],
  '34fb0116-fd71-4e6b-9c51-2115780566ae': ['sign in button','submit login','login submit button','sign in submit','login button type submit','sign in form submit','click sign in','authenticate submit','login form button','submit credentials'],
  'acb23cc8-4dd0-427d-b4e7-5db5868329dc': ['opd work link','click opd work','opd work menu','open opd work','navigate opd work','opd work navigation','opd work module','opd work nav link','click opd','opd work page'],
  'f49cc12e-4ada-474f-acd7-05b4ef5a627d': ['registration billing link','click registration billing','registration and billing','open registration billing','navigate registration billing','registration billing menu','registration billing nav','billing registration link','patient registration billing','registration billing module'],
  'f452c666-7215-44f0-a922-71ba9a97b6ed': ['male radio button','select male','male gender option','male option','male radio','patient gender male','gender male selection','click male','male selector','male gender radio'],
  '4a52704a-7899-4ba9-a999-df6a5047c45b': ['mr title','select mr','title mr','mr salutation','mr option','patient title mr','salutation mr','choose mr','mr radio option','title salutation mr'],
  '0a9d2119-d38a-4d93-a4f5-2939b50aad23': ['dr title','select dr','title dr','dr salutation','doctor title','patient title dr','salutation doctor','choose dr','dr radio option','dr title selector'],
  '380ad669-2a93-4e7c-97e2-8795c9238bc3': ['first name field','firstname input','enter first name','first name textbox','type first name','patient first name','first name entry','first name id field','first name form field','firstname entry'],
  'd5a5c03b-05d2-48ec-ab6e-150d0ce8b343': ['last name field','lastname input','enter last name','last name textbox','type last name','patient last name','last name entry','last name id field','last name form field','lastname entry'],
  'd629462d-9e29-4f8c-9994-604ccd7fb736': ['age input','enter age','age field','age placeholder','patient age','age textbox','age entry','type age','age value input','age form field'],
  'ce3878a2-4fba-4d96-b569-96d3723d46c8': ['contact number field','contact input','enter contact number','phone number field','patient contact','mobile number input','contact id field','contact number entry','type contact number','phone field'],
  'c45c0c53-b04d-4ff0-93d4-65febe50d16b': ['search box input','search input field','search textbox','type in search','search div input','search field input','general search input','search input box','click search input','search filter input'],
  'a7251610-5d45-4ecb-a707-c54f4816621e': ['naigaon option','select naigaon','naigaon area label','naigaon location','choose naigaon','naigaon selector','pick naigaon','naigaon item','naigaon selection','naigaon aria option'],
  '5104654e-1e50-4b7c-95a4-b24aedeb6bfd': ['mumbadevi option','select mumbadevi','mumbadevi area','mumbadevi location','choose mumbadevi','mumbadevi selector','pick mumbadevi','mumbadevi item','mumbadevi selection','mumbadevi option click'],
  '77846279-ded7-4728-8cbd-5abb9393fbdd': ['general opd room 1','select opd room','general opd room option','opd room 1 selection','choose opd room 1','opd room selector','room 1 option','general room 1','opd room 1 click','select room 1'],
  '106ff07e-42cc-489c-8e73-fa3436f766d8': ['next button','click next','next action','go next','next step','proceed next','next navigation','next form button','continue next','next button click'],
  'bb92b533-b126-40c6-ac00-119bcb746742': ['search keyword input','enter search keyword','search keyword field','keyword search input','search keyword placeholder','type search keyword','keyword input','search keyword textbox','keyword search field','search term input'],
  'b78a9647-a6b7-4bfb-b0c0-059b394b8e28': ['print health card checkbox','print health card label','health card print option','click print health card','print healthcard checkbox','health card print label','select print health card','health card print checkbox','print card option','healthcard print selection'],
  'be4868fd-121e-4ab1-bb9a-bb16a7e455a0': ['recon name input','enter recon name','recon name field','reconName textbox','type recon name','recon name entry','reconciliation name field','recon name form input','recon name xpath input','recon name editor input'],
  'a0aec51c-25b2-4051-932d-a3b727854ea8': ['recon name id','reconName input','recon name field id','enter recon name','reconName selector','recon name textbox id','type recon name id','recon name entry id','reconciliation name id','recon name id field'],
  'b8d20131-2459-478a-9e12-383e21456397': ['description textarea recon','recon description field','description textbox recon','enter recon description','reconciliation description','description queryview','type description textarea','recon form description','description field queryview','description text area recon'],
  '1b7bb528-de27-4f68-b45e-e708c511b54d': ['from date time','start date input','from date placeholder','start date field','from datetime entry','start datetime placeholder','from date field','date range start','start date placeholder input','from date picker'],
  '2b1b60a7-a740-437b-9c83-0b25019fab70': ['from date time id','FromDateTime input','from datetime field','start datetime id','from date id input','from datetime id field','from date time entry id','start date id','from datetime selector','FromDateTime id'],
  '94a037dd-c9cb-467c-84f3-41fb8862e0e8': ['select time hover','hover select time','from datetime time hover','hover time picker','select time anchor hover','hover time select','hover from time','time picker hover','hover datetime time select','from time hover'],
  '7680c452-2a3f-4832-abdf-feb8349ad147': ['hover select time link','hover select time anchor','select time link hover','hover time selection','time selection hover','hover from time link','hover select time title','select time title hover','hover time anchor','time anchor hover'],
  'b7145f81-981e-432c-91a1-ee60b124f727': ['from date picker cell','select from date','from datetime picker date','from date calendar cell','pick from date','from datetime calendar','select start date cell','from date table cell','date picker from cell','calendar from date click'],
  'e4df1cc7-a2c8-4323-88eb-08d8f219f036': ['to date time','end date input','to date placeholder','end date field','to datetime entry','end datetime placeholder','to date field','date range end','end date placeholder input','to date picker'],
  '2e83d14a-af5a-4c0f-bea6-60dc3a276b05': ['to date time id','ToDateTime input','to datetime field','end datetime id','to date id input','to datetime id field','to datetime entry id','end date id','to datetime selector','ToDateTime id'],
  '7fc8b58e-4c27-4f0e-a6c5-b2ebb770932f': ['to date picker cell','select to date','to datetime picker date','to date calendar cell','pick end date','to datetime calendar','select end date cell','to date table cell','date picker to cell','calendar end date click'],
  '6d510f81-3403-4de3-9dfa-d226464cb523': ['join type dropdown','select join type','join type selector','join type select element','join type combo','join type option','choose join type','join type list','join type picker','divJoinType select'],
  '55893689-b3ac-450f-8b4a-8949b7fe2365': ['join type id','JoinType input','join type field id','select join type id','JoinType selector','join type id field','join type entry id','join type id input','choose join type id','join type id picker'],
  'a3b83187-805e-441c-9946-d8ceb0eea076': ['source type selector','select source type','source type combobox','source type dropdown','choose source type','source type option','data source type','recon source type','source type picker','source type list'],
  'f071b0ca-de06-4134-97fb-825a7138ea7a': ['source type id','SourceType1 field','source type 1','select source type id','SourceType1 input','source type 1 selector','source type id field','source type 1 dropdown','choose source type id','source type 1 option'],
  '13625081-5f83-4583-9378-1aec633316dd': ['source table dropdown','data source table','source table 1 selector','select source table','source table id dropdown','data source container select','source table list','choose source table','source table option','SourceTableID1 select'],
  'e281d0cd-22fe-4ebc-9b44-deb0e9224854': ['source table id','SourceTableID1 input','source table 1 id','select source table id','SourceTableID1 selector','source table 1','source table field id','source table id input','choose source table id','source table 1 field'],
  '91db56dc-1c61-4802-a6aa-879ec5cd81a5': ['none selected button','click none selected','multiselect none selected','no selection button','none selected option','select none','clear selection button','none selected action','unselected button','select button none selected'],
  '2179e090-8334-422b-98d4-1aacc492b1af': ['select all label','check select all','select all checkbox label','check all items','select all option label','check all label','select all label click','check all checkbox','select all label selector','all items select label'],
  '2648afaf-7c85-4b5d-ab8c-602f1dc7c75e': ['select all checkbox','check all checkbox','multiselect all checkbox','select all input','check all input','multiselect all input','select all check','all checkbox input','check all multiselect','select all checkbox value'],
  'bd209fb2-0913-4c8a-b682-6f504b1bc079': ['add button role','click add','add action','add item button','add record button','role add button','add new item','add row button','add button click','add entry'],
  '50a47c19-61f0-44e0-8e40-403895e8f38b': ['add row button','addRowButton','click add row','add row action','add data row','new row button','insert row button','add row id','row add button','add row click'],
  '33c190ac-8bbf-4770-9cf9-415c134788d2': ['delete link','delete data source','remove data source','delete row link','data source delete','delete entry link','remove source link','delete from container','data container delete','source delete action'],
  '9d50785a-a602-4d35-9006-a139ace6b627': ['select checkbox id','check item checkbox','checkbox value select','check id input','select record checkbox','checkbox id field','select row checkbox','check item by value','select record by checkbox','checkbox select value'],
  '03efe7b3-f241-4559-bf79-156a0aa50a0e': ['hover delete button','delete button hover','btnDelete hover','hover delete','delete hover action','hover remove button','hover delete icon','delete icon hover','hover delete action','remove button hover'],
  '099b16a8-af0d-4636-bb7b-dee8aed3ef83': ['double click yes','double click yes button','double click confirm','yes button double click','double click affirmative','double click confirm button','yes double click','confirm double click','yes dbl click','double click yes role'],
  '0907c346-97b6-4fe6-a4ed-362ae062d6d1': ['double click cancel','cancel double click','double click cancel button','double click dismiss','cancel button double click','double click abort','cancel dbl click','double click cancel role','dismiss double click','cancel double click role'],
  '99348ef4-1721-4576-a30d-22f4a38e195f': ['login validation message','assert login error','login error message','validation message assert','login form error span','assert error text login','login validation span','check login error','login error assertion','validation message login form'],
  '1a09efac-4861-49e4-a1a8-d7e1c585f77e': ['username label','user name label click','click username label','label for username','login username label','username label selector','user name form label','username field label click','label username','username label element'],
  '49fb1154-2ad3-4365-b6b3-fb248e499c82': ['source type 2 validation','assert source type 2','source type 2 assert text','validation message source type','check source type 2 error','source type 2 error','source type validation assert','SourceType2 message','SourceType2 assert','SourceType2 validation message'],
  'ade7f99a-b7cf-4359-aa71-a895eb7a7f8b': ['operation management menu','click operation management','operation management nav','open operation management','operation management link','navigate operation management','operation management item','operation mgmt menu','operation management module','m233p'],
  '69aedb17-995c-466d-b343-01d4c8c63552': ['extract layer menu','click extract layer','extract layer nav','open extract layer','extract layer link','navigate extract layer','extract layer module','extract layer item','extract layer navigation','m212p'],
  '86cc5398-7d6a-4b1a-aa4f-6814fb3d810f': ['enter flow name','flow name input placeholder','flow name placeholder field','type flow name','flow name search box','flow name entry','flow name text input','search flow name','flow name field placeholder','flow name input field'],
  '8af757b2-5434-400e-965d-0b0f0ee6630c': ['recon name comparison','recon name comparison input','enter recon name comparison','comparison recon name field','type recon name comparison','comparison form recon name','reconName comparison component','recon name input comparison','recon name frmComparison','comparison recon name'],
  '99d79762-3e04-4861-9174-f846d1cc0b9d': ['description comparison','comparison description textarea','recon comparison description','enter comparison description','comparison form description','description comparison input','type comparison description','comparison component description','recon description comparison','description frmComparison'],
  'cc6a2187-34f5-49d6-aadf-168e049af97c': ['join recon node','click join recon','join reconciliation node','recon join node','join recon canvas node','join recon flow node','select join recon','join recon element','recon join canvas','join recon rf node'],
  'c375b5b4-08ef-4b13-8f30-2852bd13a1cc': ['data match recon node','click data match recon','data match reconciliation','data match recon canvas','data match node','recon data match','data match recon element','data match flow node','select data match recon','data match recon rf node'],
};

const locators = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'locators.json'), 'utf8'));
const locMap = new Map(locators.map(l => [l.id, l.name]));

let matched = 0, missing = 0;
for (const id of Object.keys(aliases)) {
  if (locMap.has(id)) matched++;
  else { console.log('MISSING ID:', id); missing++; }
}
console.log(`Matched: ${matched} / Missing: ${missing} / Total entries: ${Object.keys(aliases).length}`);

const outPath = path.join(DATA_DIR, 'nl-locator-aliases.json');
const tmp = outPath + '.tmp';

let existing = {};
if (!FORCE) {
  try { existing = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch { /* file absent — start fresh */ }
}
// Merge: hardcoded entries fill in missing keys; existing UI-added entries are never removed.
const merged = Object.assign({}, aliases, existing);
fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf8');
fs.renameSync(tmp, outPath);
console.log(FORCE ? 'Overwritten:' : 'Merged into:', outPath);
console.log('Total entries after write:', Object.keys(merged).length);
