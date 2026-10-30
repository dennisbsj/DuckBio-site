/* DuckBio browser-only XLSX export; no external dependencies or server uploads. */
(function(){
 "use strict";
 const enc=new TextEncoder();
 const xmlText=(value)=>String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,"");
 const column=(index)=>{let x=index+1,s="";while(x){s=String.fromCharCode(65+(x-1)%26)+s;x=Math.floor((x-1)/26)}return s};
 const u16=(v)=>[v&255,(v>>>8)&255],u32=(v)=>[v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255];
 const crcTable=new Uint32Array(256);
 for(let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=c&1?0xEDB88320^(c>>>1):c>>>1;crcTable[i]=c>>>0}
 const crc=(bytes)=>{let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0};
 const zipStore=(files)=>{
  const pieces=[],directory=[];let offset=0;
  const add=(bytes)=>{pieces.push(bytes);offset+=bytes.length};
  for(const [name,body] of files){
   const nameBytes=enc.encode(name),data=enc.encode(body),sum=crc(data),start=offset;
   add(new Uint8Array([80,75,3,4,...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),...u32(sum),...u32(data.length),...u32(data.length),...u16(nameBytes.length),...u16(0)]));
   add(nameBytes);add(data);
   directory.push(new Uint8Array([80,75,1,2,...u16(20),...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),...u32(sum),...u32(data.length),...u32(data.length),...u16(nameBytes.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(start)]));
   directory.push(nameBytes);
  }
  const centralOffset=offset;for(const d of directory)add(d);const centralSize=offset-centralOffset;
  add(new Uint8Array([80,75,5,6,...u16(0),...u16(0),...u16(files.length),...u16(files.length),...u32(centralSize),...u32(centralOffset),...u16(0)]));
  const out=new Uint8Array(offset);let p=0;for(const item of pieces){out.set(item,p);p+=item.length}return out;
 };
 const sheetXml=(rows)=>{
  const content=rows.map((row,ri)=>{
   const cells=row.map((v,ci)=>{
    if(v===null||v===undefined)return"";
    const ref=column(ci)+(ri+1),style=ri===0?' s="1"':ri===1?' s="2"':'';
    if(typeof v==="number"&&Number.isFinite(v))return'<c r="'+ref+'"'+style+'><v>'+v+'</v></c>';
    return'<c r="'+ref+'" t="inlineStr"'+style+'><is><t xml:space="preserve">'+xmlText(v)+'</t></is></c>';
   }).join("");
   return'<row r="'+(ri+1)+'">'+cells+'</row>';
  }).join("");
  const maxColumns=Math.max(2,...rows.map(r=>r.length));
  const widths=Array.from({length:maxColumns},(_,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+(i===0?43:Math.min(37,i===1?28:22))+'" customWidth="1"/>').join("");
  return'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>'+widths+'</cols><sheetData>'+content+'</sheetData></worksheet>';
 };
 const generate=(rows)=>{
  if(!Array.isArray(rows)||!rows.length)throw Error("At least one worksheet row is required");
  const types='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';
  const rels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const workbook='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="DuckBio Estimate" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const wbRels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  const styles='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><color rgb="FF1B394A"/><name val="Aptos"/></font><font><b/><sz val="15"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font><font><b/><sz val="11"/><color rgb="FF154E66"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF15465F"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>';
  return zipStore([["[Content_Types].xml",types],["_rels/.rels",rels],["xl/workbook.xml",workbook],["xl/_rels/workbook.xml.rels",wbRels],["xl/worksheets/sheet1.xml",sheetXml(rows)],["xl/styles.xml",styles]]);
 };
 const download=(filename,rows)=>{
  const bytes=generate(rows);
  const blob=new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=filename.endsWith(".xlsx")?filename:filename+".xlsx";
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 window.DuckBioXlsx={download,generate};
})();
