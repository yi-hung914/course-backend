import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import xlsx from 'xlsx';
import express from 'express';
import jwt from 'jsonwebtoken';
import { loadConfigFromFile } from '@prisma/config';
import { parseCourseWorkbook, buildCourses } from '../lib/courseImport.js';
import { createAdminRouter } from '../admin.routes.js';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const header = ['編號','學期','科目代碼(新碼全碼)','系所代碼','年級','上課班組','科目中文名稱','授課教師姓名','上課人數','學分數','課別名稱','上課地點','上課星期','上課節次'];
const row = [1,'1151','TEST001','11140',1,'A','測試課程','測試教師',40,2,'專業必修','A101',1,'1,2,4'];
function workbook(type) {
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet([header,row]), '課程');
  return xlsx.write(wb, {type:'buffer',bookType:type});
}

test('XLS and XLSX preserve Chinese text and split non-contiguous periods', () => {
  for (const type of ['xls','xlsx']) {
    const parsed = parseCourseWorkbook(workbook(type));
    assert.equal(parsed.detectedSemester,'1151');
    const result = buildCourses('1151',parsed.rows,parsed.IDX);
    assert.equal(result.stats.courses,1);
    assert.equal(result.stats.schedules,2);
    assert.equal(result.courses[0].name,'測試課程');
    assert.deepEqual([...result.courses[0].sections.get('A').schedules.values()].map(s=>[s.start,s.end]),[[1,2],[4,4]]);
  }
  assert.throws(()=>parseCourseWorkbook(Buffer.from('invalid workbook')), /表頭|讀取|工作表/);
});

test('Prisma loads a config through the patched merge dependency', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'course-prisma-config-'));
  const file = path.join(dir,'prisma.config.cjs');
  try {
    fs.writeFileSync(file,'module.exports = '+JSON.stringify({schema:path.join(root,'prisma/schema.prisma'),migrations:{path:path.join(root,'prisma/migrations')}}));
    const result = await loadConfigFromFile({configRoot:dir,configFile:file});
    assert.equal(result.error,undefined);
    assert.equal(result.config.schema,path.join(root,'prisma/schema.prisma'));
  } finally { fs.unlinkSync(file); fs.rmdirSync(dir); }
});

test('Prisma schema validates and client loads without contacting a database', () => {
  const run = spawnSync(process.execPath,[path.join(path.dirname(require.resolve('prisma/package.json')),'build/index.js'),'validate'],{
    cwd:root,encoding:'utf8',env:{...process.env,DATABASE_URL:'postgresql://test:test@127.0.0.1:1/test'},timeout:30000,
  });
  assert.equal(run.status,0,run.stderr+run.stdout);
  assert.equal(require('@prisma/client/package.json').version,'6.19.3');
});

test('Import API rejects anonymous/student callers and previews both formats without writes', async () => {
  const oldSecret = process.env.JWT_ACCESS_SECRET;
  process.env.JWT_ACCESS_SECRET='security-regression-test-only-secret';
  const prisma = {
    user:{findUnique:async ({where})=>({id:where.id,role:where.id==='admin'?'admin':'student'})},
    course:{count:async()=>0},
    $transaction:()=>{throw new Error('Preview must not write to a database');},
  };
  const app=express();app.use(express.json());app.use('/api/admin',createAdminRouter({prisma}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const url='http://127.0.0.1:'+server.address().port+'/api/admin/courses/import';
  try {
    for(const [user,status] of [[null,401],['student',403],['admin',200]]) {
      for(const type of ['xls','xlsx']) {
        const headers={'Content-Type':'application/json'};
        if(user)headers.Authorization='Bearer '+jwt.sign({sub:user},process.env.JWT_ACCESS_SECRET,{expiresIn:'1m'});
        const response=await fetch(url,{method:'POST',headers,body:JSON.stringify({fileBase64:workbook(type).toString('base64'),filename:'test.'+type,dryRun:true})});
        assert.equal(response.status,status);
        if(status===200){const data=await response.json();assert.equal(data.dryRun,true);assert.equal(data.preview.courses,1);assert.equal(data.preview.schedules,2);}
      }
    }
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(oldSecret===undefined)delete process.env.JWT_ACCESS_SECRET;else process.env.JWT_ACCESS_SECRET=oldSecret;}
});
