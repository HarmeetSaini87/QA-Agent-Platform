'use strict';
// One-shot merge script — adds aliases for locators not yet in the alias map.
// Existing entries (including UI-added) are never overwritten (Object.assign order: new first, existing wins).
// Safe to re-run — idempotent.
const fs = require('fs');
const path = require('path');

const outPath = path.resolve(__dirname, '..', 'data', 'nl-locator-aliases.json');

const newAliases = {
  '31b51a85-e7e3-4cc0-b8d9-4e7423f57b77': ['click label','select label text','activate label','press label button','tap label element','click on label','interact with label','select the label','trigger label','click label field'],
  '0acde131-136c-40cd-a09f-061cd7da96cc': ['click label element','select label element','activate label element','press label','tap label','click on label element','interact with label element','choose label','trigger label element','label click action'],
  '428f249c-3033-48d4-8d7b-8b9db91b6a03': ['click upload','upload file','select upload','press upload button','trigger upload','click upload button','tap upload','activate upload','initiate upload','file upload button'],
  'b56b77c5-9593-4da9-9562-f4b1234f636b': ['fill textarea','enter text area','type in textarea','edit textarea','write text area','populate textarea','fill text area','input textarea text','type message area','edit text area'],
  '6043f682-67d9-41eb-bead-ee39576526d4': ['click save','save changes','press save','tap save','click save button','save document','submit save','activate save','trigger save','save form'],
  '44588dcc-7887-4b95-a25c-62b2a40b0710': ['click filter01','activate filter01','select filter01','click filter option','press filter01','trigger filter01','tap filter01','click filter button','select filter option','click filter element'],
  'db2878b7-9b56-4d1c-b08d-bb3a82daea9f': ['click value1','select value1','activate value1','press value1','tap value1','click value option','select value option','trigger value1','click value field','choose value1'],
  '378623ad-303d-4d6c-afc0-7b201c8e45b4': ['click filter button','activate filter','select filter','press filter','trigger filter','tap filter','apply filter','use filter','click filter row','select filter item'],
  '00691fbe-23b3-411d-b8ee-c22af502a09f': ['click m211p','select m211p','activate m211p','press m211p','tap m211p','click m211p button','trigger m211p','click m211p field','choose m211p','select m211p option'],
  '85a6ae14-81f1-4f33-80f3-46a1317eec36': ['gateway type grid info','check gateway type grid','view gateway type grid','inspect gateway grid','gateway grid information','gateway type information','view grid info','gateway type details','check grid info','gateway type grid details'],
  'ae5db68c-491b-4bdf-bc11-bffea4a4d0fd': ['message success','success message','check success','view success message','success notification','success alert','success indicator','see success','confirm success','success confirmation'],
  '71b51c97-98dc-41dd-9ce9-93d1935c53ef': ['click dv render body','activate dv render','select dv render body','press dv render','tap dv render body','click render body','trigger dv render','interact with dv render','click dv body','activate render body'],
  'e7784de5-5006-4e3e-879f-9cfb142340bc': ['click dfgsggdf','select dfgsggdf','activate dfgsggdf','press dfgsggdf','tap dfgsggdf','click dfgsggdf button','trigger dfgsggdf','click dfgsggdf field','choose dfgsggdf','select dfgsggdf option'],
  '3eb80cb3-4336-4dde-ac1a-0fef2816d59d': ['gateway grid info','check gateway grid','view gateway grid','inspect gateway grid','gateway information','grid information','view grid info','gateway details','check grid info','gateway grid details'],
  '24a6532e-9ed7-43e2-a1cc-972c1bb6672b': ['click m58p','select m58p','activate m58p','press m58p','tap m58p','click m58p button','trigger m58p','click m58p field','choose m58p','select m58p option'],
  'bc6729d8-83e5-42d7-a907-15d7117661cb': ['click bbnnmmnn','select bbnnmmnn','activate bbnnmmnn','press bbnnmmnn','tap bbnnmmnn','click bbnnmmnn button','trigger bbnnmmnn','click bbnnmmnn field','choose bbnnmmnn','select bbnnmmnn option'],
  '73cea057-da8c-4033-b427-52d6c11dff35': ['click reoccurrence','select reoccurrence','activate reoccurrence','press reoccurrence','tap reoccurrence','click reoccurrence option','trigger reoccurrence','choose reoccurrence','set reoccurrence','select reoccurrence field'],
  '97eb0b42-a19a-46d4-ad1b-4db92590ea33': ['click disable','disable option','select disable','press disable','tap disable','click disable button','activate disable','toggle disable','choose disable','click disable field'],
  '2d2f9bcf-61dd-4452-a26a-6a1cb871659b': ['click lookback range','select lookback range','activate lookback','press lookback range','tap lookback range','set lookback range','choose lookback range','trigger lookback','select lookback option','look back range field'],
  'c21ff1fa-4640-4e31-8522-1baac13cb44e': ['click start node','start process node','begin flow node','press start node','activate start node','trigger start node','click start element','initiate node','start canvas node','flow start node'],
  '417ef641-fb9d-45c4-939b-1fde98fbf907': ['click start point','start action point','begin process point','press start point','tap start point','activate start point','trigger start point','initiate start point','start point button','flow start point'],
  '7290bb79-f8c5-4988-8ceb-3cf0dbbbe13c': ['click date','select date','choose date','press date','tap date','pick date','set date','click date field','enter date','activate date picker'],
  'c8c01b89-f9d7-4cbf-8104-7550e3c5a0fa': ['click start widget','start widget','press start widget','tap start widget','activate start widget','trigger start widget','initiate start widget','start widget element','start widget button','widget start'],
  '9b59b23e-fd88-4ea1-8a93-07ff5a034445': ['click svg image','click svg icon','select svg','tap svg image','press svg','activate svg','click svg button','trigger svg','interact with svg','click image element'],
  '6d15f9a4-88fc-4769-8b8c-925666ef538f': ['click pn id 156','select pn id 156','activate pn 156','press pn 156','tap pn id 156','click pn element 156','select part 156','trigger pn 156','choose pn 156','pn id 156 button'],
  '39369c4b-e392-4450-88f3-7c0d807ee91c': ['click pn id 135','select pn id 135','activate pn 135','press pn 135','tap pn id 135','click pn element 135','select part 135','trigger pn 135','choose pn 135','pn id 135 button'],
  'cfd62485-a525-49f0-adc8-c746f12fc872': ['click start flow','start flow','begin flow','press start flow','activate start flow','trigger start flow','initiate flow','start flow node','flow start button','flow start action'],
  '188cdf6d-dc73-4402-a2b1-93278e2481d2': ['recon flow list grid','check recon flow grid','view recon grid','inspect recon grid','flow list information','recon grid information','view recon info','recon flow details','check recon grid','recon grid details'],
  'ed85334a-d275-4f6a-97df-167bd8a26a86': ['success banner message','operation success','success banner','check success banner','view success banner','success notification message','success alert message','success indicator message','see success message','confirm success message'],
  '9600553f-758a-434d-bb87-d217de4bdd1e': ['message alert','alert message','check alert','view alert message','alert notification','alert warning','alert indicator','see alert','confirm alert','alert confirmation'],
  '03cbc37e-ebea-4a9f-91f6-6fcaf6102aa5': ['click start recon','start recon','begin recon','press start recon','activate start recon','trigger start recon','initiate recon','start recon node','recon start button','recon start action'],
  'e42ccdd3-2c16-4197-ad87-c5aba69cfd18': ['click data match recon','select data match','activate data match','press data match','tap data match recon','click data match button','trigger data match','choose data match','select recon option','click match recon'],
  'ba4a20b4-9115-494a-af37-7d69d48fcc97': ['click delete','delete item','remove element','press delete','tap delete','activate delete','trigger delete','click delete button','confirm delete','remove item'],
  'c9907c46-8d67-4fbc-a2c9-d001ca04aa9d': ['right click start','context menu start','right click start button','open context start','right click trigger','access start menu','context start menu','right click action','context click start','right click start option'],
  '131a706e-86cc-4aad-abdf-5a9d82eac1c1': ['right click join recon','context menu join','right click join button','open context join','right click recon','access join menu','context join recon','right click join action','context click join','right click join option'],
  '0e56cb94-40d9-4505-9a2e-d4d45d059eb5': ['click dismiss','dismiss notification','close dismiss','press dismiss','tap dismiss','activate dismiss','trigger dismiss','click dismiss button','close dialog','dismiss popup'],
  'fa0feeb4-eed0-4829-98e2-c7026cd8d4be': ['switch to iframe','enter iframe','activate iframe','switch flow builder','enter flow builder','navigate to iframe','interact with iframe','select iframe','click flow builder iframe','access flow iframe'],
  'dac6482b-85c9-4c19-8516-8fd05f1f2b21': ['click start canvas','start canvas node','begin canvas','press start canvas','activate start canvas','trigger start canvas','initiate canvas','start canvas element','canvas start node','canvas start button'],
  '59bbef5c-dbb3-4338-93c2-8ea3040c9a17': ['click start step','start step','begin step','press start step','activate start step','trigger start step','initiate step','start step node','step start button','step start action'],
  'cb34e983-5ca8-410a-9ea0-11bcbd292d10': ['click start action','start action','begin action','press start action','activate start action','trigger start action','initiate action','start action node','action start button','action start element'],
  '8bff8370-64ca-4714-8d8e-08cd5c011480': ['click description','enter description','edit description','press description','tap description','activate description','type description','fill description','click description field','add description'],
  'aad708c3-3e0d-4ff8-8c51-f3f1e26345b6': ['click description field','enter description text','edit description text','press description field','tap description field','activate description field','type description text','fill description field','click description area','add description text'],
  'e5faea46-24f0-45c5-8ab8-45848ff702bb': ['select month dropdown','click month','choose month','press month','tap month','activate month','pick month','click month field','select month option','open month list'],
  'a614439f-87b4-41f5-94f6-9312a5c9706b': ['select month','click month selector','choose month option','press month selector','tap month selector','activate month selector','pick month option','select month value','open month selector','month picker'],
  'f0bef07a-3183-4312-919b-5dcf76871781': ['click hour','select hour','choose hour','press hour','tap hour','activate hour','pick hour','click hour field','select hour option','enter hour'],
  '44f734b9-1d3b-4d74-9432-19224191846e': ['click hour field','select hour value','choose hour option','press hour field','tap hour field','activate hour field','pick hour value','click hour selector','select hour input','enter hour value'],
  '60bdb35a-a94d-42e6-9afb-01d139f16f82': ['hover record interactions','hover auto populate','hover record browser','hover steps recording','hover record feature','hover browser recording','hover auto populate steps','hover record steps','hover browser auto populate','hover interactive recording'],
  '96027d84-df8b-4eab-a53c-c78a15ff52c6': ['double click start','double tap start','double select start','activate start twice','double press start','double click start button','trigger start twice','open start dialog','double click start element','rapid click start'],
  'fc6d3c1c-59d2-4803-9ee4-5ad0f5781722': ['double click start node','double tap start node','double select start node','activate start node twice','double press start node','double click start node button','trigger start node twice','open start node','double click node','rapid click start node'],
  'fac31eb3-e2dd-499b-a740-7cefa51b39b4': ['drag svg to path','drag image to path','drag svg element','drag drop svg path','move svg to path','drag image element','drag to path','drag svg path target','drag drop to path','move svg element path'],
  'ad41c3ed-5a6b-4612-bd10-552ce07343c7': ['drag svg to div','drag image to div','drag svg element div','drag drop svg div','move svg to div','drag image to div','drag to div','drag svg div target','drag drop to div','move svg div element']
};

const existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
const before = Object.keys(existing).length;
// existing entries win — new aliases only fill gaps
const merged = Object.assign({}, newAliases, existing);
const after = Object.keys(merged).length;
const tmp = outPath + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf8');
fs.renameSync(tmp, outPath);
console.log('Before:', before, '| New added:', after - before, '| Total:', after);
