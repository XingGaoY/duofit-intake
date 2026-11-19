import { Pool } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const ORIGIN = 'https://xinggaoy.github.io';
const cors = { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Vary': 'Origin', 'Cache-Control': 'no-store' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
const validUUID = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
const validText = (value, max) => typeof value === 'string' && value.trim().length <= max;
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

let pool;
function db() {
  if (pool) return pool;
  if (!process.env.DUOFIT_DB_PASSWORD || !process.env.DATABASE_URL) throw new Error('Database access not configured');
  const url = new URL(process.env.DATABASE_URL);
  url.username = 'duofit_intake_api';
  url.password = process.env.DUOFIT_DB_PASSWORD;
  url.pathname = '/fitness';
  pool = new Pool({ connectionString: url.toString(), max: 3, idleTimeoutMillis: 30000 });
  pool.on('error', () => {});
  return pool;
}

async function checkAuth(request) {
  const supplied = request.headers.get('authorization')?.match(/^Bearer\s+([a-f0-9]{64})$/i)?.[1];
  if (!supplied) return false;
  const result = await db().query('SELECT 1 FROM public.duofit_approved_devices WHERE device_hash=$1 AND revoked_at IS NULL LIMIT 1',[hashToken(supplied)]);
  return result.rowCount === 1;
}
const bodyOf = async (req, limit = 16000) => { const contentLength = Number(req.headers.get('content-length') || 0); if (contentLength > limit) throw new Error('Payload too large'); const body = await req.text(); if (Buffer.byteLength(body) > limit) throw new Error('Payload too large'); return JSON.parse(body); };

async function registerDevice(request) {
  const value = await bodyOf(request,2000);
  if (!/^[a-f0-9]{64}$/.test(value.device_hash||'') || !validText(value.label,40) || value.label.trim().length<2) return json({error:'Invalid device request'},400);
  const count = await db().query("SELECT count(*)::int AS total FROM intake_stage.device_requests WHERE requested_at > now() - interval '24 hours'");
  if(count.rows[0].total>=50)return json({error:'Too many device requests'},429);
  const id=randomUUID();
  await db().query('INSERT INTO intake_stage.device_requests (id,device_hash,device_label) VALUES ($1,$2,$3) ON CONFLICT (device_hash) DO NOTHING',[id,value.device_hash,value.label.trim()]);
  const stored=await db().query('SELECT id FROM intake_stage.device_requests WHERE device_hash=$1',[value.device_hash]);
  return json({request_id:stored.rows[0].id,status:'pending'},202);
}
async function deviceStatus(request) {
  const supplied=request.headers.get('authorization')?.match(/^Bearer\s+([a-f0-9]{64})$/i)?.[1];
  const id=new URL(request.url).searchParams.get('id');
  if(!supplied||!validUUID(id))return json({error:'Invalid request'},400);
  const result=await db().query('SELECT a.approved_at,a.revoked_at FROM intake_stage.device_requests r LEFT JOIN public.duofit_approved_devices a ON a.request_id=r.id AND a.device_hash=r.device_hash WHERE r.id=$1 AND r.device_hash=$2',[id,hashToken(supplied)]);
  if(!result.rowCount)return json({error:'Device request not found'},404);
  return json({status:result.rows[0].revoked_at?'revoked':result.rows[0].approved_at?'approved':'pending'});
}

async function submitIntake(req) {
  const value = await bodyOf(req);
  if (!validUUID(value.id) || value.person !== 'partner' || !validDate(value.date) || !['breakfast','lunch','dinner','snack'].includes(value.meal) || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 100) return json({ error:'Invalid meal' }, 400);
  if (!value.items.every((item) => validText(item.name,100) && item.name.trim() && Number.isFinite(item.weight_g) && item.weight_g > 0 && item.weight_g <= 100000 && ['raw','cooked','edible','unknown'].includes(item.weight_kind) && typeof item.oily === 'boolean' && typeof item.rinsed === 'boolean' && validText(item.note ?? '',500))) return json({ error:'Invalid food item' }, 400);
  const result = await db().query('INSERT INTO intake_stage.intake_submissions (id,person_code,intake_date,meal_type,items,client_submitted_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING RETURNING id', [value.id,'partner',value.date,value.meal,JSON.stringify(value.items),value.submitted_at || null]);
  return json({id:value.id,accepted:true,duplicate:result.rowCount===0},result.rowCount?201:200);
}
async function submitMeasurement(req) {
  const value = await bodyOf(req);
  const weight = value.weight_kg == null ? null : Number(value.weight_kg);
  const waist = value.waist_cm == null ? null : Number(value.waist_cm);
  if (!validUUID(value.id) || value.person !== 'partner' || !validDate(value.date) || (weight===null && waist===null) || (weight!==null && (!Number.isFinite(weight) || weight<20 || weight>400)) || (waist!==null && (!Number.isFinite(waist) || waist<20 || waist>250)) || !validText(value.note||'',500)) return json({error:'Invalid measurement'},400);
  const result = await db().query('INSERT INTO intake_stage.measurement_submissions (id,person_code,measured_on,weight_kg,waist_cm,note) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING RETURNING id',[value.id,'partner',value.date,weight,waist,value.note||'']);
  return json({id:value.id,accepted:true,duplicate:result.rowCount===0},result.rowCount?201:200);
}
async function submitActivity(req) {
  const value=await bodyOf(req);
  if(!validUUID(value.id)||value.person!=='partner'||!validDate(value.date)||!['strength','dance','running','cycling','other'].includes(value.kind)||!validText(value.note||'',500)||!Array.isArray(value.image_keys)||value.image_keys.length>5||!value.image_keys.every(k=>typeof k==='string'&&/^partner\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(k)))return json({error:'Invalid activity'},400);
  const result=await db().query('INSERT INTO intake_stage.activity_submissions (id,person_code,activity_on,activity_type,note,image_keys) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING RETURNING id',[value.id,'partner',value.date,value.kind,value.note||'',JSON.stringify(value.image_keys)]);
  return json({id:value.id,accepted:true,duplicate:result.rowCount===0},result.rowCount?201:200);
}
let s3;
async function uploadImage(req) {
  if (!process.env.AWS_ENDPOINT_URL_S3 || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) return json({error:'Object storage unavailable'},503);
  const length=Number(req.headers.get('content-length')||0);
  if(length>8.5*1024*1024)return json({error:'Image too large'},413);
  const form=await req.formData();const image=form.get('file'),date=form.get('date');
  if(!(image instanceof File)||image.size<1||image.size>8*1024*1024||!validDate(date)||!['image/jpeg','image/png','image/webp'].includes(image.type))return json({error:'Invalid image'},400);
  const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[image.type];const key=`partner/${date}/${randomUUID()}.${ext}`;
  s3 ||= new S3Client({region:process.env.AWS_REGION||'us-east-2',endpoint:process.env.AWS_ENDPOINT_URL_S3,forcePathStyle:true});
  await s3.send(new PutObjectCommand({Bucket:'duofit-activity-images',Key:key,Body:new Uint8Array(await image.arrayBuffer()),ContentType:image.type}));
  return json({key,uploaded:true},201);
}

async function listSubmissions(request) {
  const kind = new URL(request.url).searchParams.get('kind') || 'intake';
  const table = {intake:'intake_stage.intake_submissions',measurement:'intake_stage.measurement_submissions',activity:'intake_stage.activity_submissions'}[kind];
  if (!table) return json({error:'Unknown kind'},400);
  const result=await db().query(`SELECT * FROM ${table} WHERE person_code='partner' AND status IN ('pending','needs_review') ORDER BY created_at DESC LIMIT 100`);
  return json({kind,records:result.rows});
}

async function nutritionOverview(request) {
  const params=new URL(request.url).searchParams,date=params.searchParams.get('date'),scenario=params.searchParams.get('day_class')||'actual';
  if(!validDate(date))return json({error:'Invalid date'},400);
  const conn=db();
  const plan=await conn.query(`SELECT v.id,v.version,v.effective_from,v.effective_to,v.goal_weight_kg FROM public.nutrition_plan_versions v JOIN public.persons p ON p.id=v.person_id WHERE p.code='partner' AND v.status='active' AND v.effective_from<=$1 AND (v.effective_to IS NULL OR v.effective_to>=$1) ORDER BY v.version DESC LIMIT 1`,[date]);
  if(!plan.rows.length)return json({plan:null,targets:null,scenarios:[],actual:{}},200);
  const v=plan.rows[0];
  const [base,rules,intakes,activities]=await Promise.all([
    conn.query('SELECT nutrient,target_min,target_center,target_max,adjustment_policy FROM public.nutrition_targets WHERE plan_id=$1',[v.id]),
    conn.query('SELECT day_class,nutrient,adjustment_type,calculation_mode,weight_basis,value_min,value_center,value_max,rule_priority FROM public.nutrition_activity_rules WHERE plan_id=$1 AND enabled=true ORDER BY rule_priority ASC',[v.id]),
    conn.query(`SELECT SUM(i.kcal) FILTER (WHERE i.kcal IS NOT NULL) energy, SUM(i.protein_g) FILTER (WHERE i.protein_g IS NOT NULL) protein, SUM(i.carbs_g) FILTER (WHERE i.carbs_g IS NOT NULL) carbs, SUM(i.fat_g) FILTER (WHERE i.fat_g IS NOT NULL) fat, SUM(i.fiber_g) FILTER (WHERE i.fiber_g IS NOT NULL) fiber,COUNT(i.id) item_count FROM public.intake_items i JOIN public.meals m ON m.id=i.meal_id JOIN public.persons p ON p.id=m.person_id WHERE p.code='partner' AND m.consumed_on=$1 AND m.status='confirmed' AND i.status='confirmed'`,[date]),
    conn.query(`SELECT activity_type FROM public.activities a JOIN public.persons p ON p.id=a.person_id WHERE p.code='partner' AND a.occurred_on=$1 AND a.status='confirmed'`,[date])
  ]);
  const targets={};
  const map={kcal:'energy',energy:'energy',protein:'protein',carbs:'carbs',fat:'fat',fiber:'fiber'};
  for(const t of base.rows){const key=map[t.nutrient];if(key)targets[key]={min:t.target_min,center:t.target_center,max:t.target_max};}
  const scenarios=[...new Set(rules.rows.map(r=>r.day_class))].map(code=>({code,label:({rest:'休息日',ballet_low:'低强度芭蕾',low_activity:'低强度活动',dance_other:'舞蹈训练',strength_upper:'上肢力量',strength_lower:'下肢力量',double_training:'双训练日'})[code]||code}));
  // An unclassified actual day has no invented carbohydrate override.
  const selected = scenario==='actual' ? null : scenarios.find(s=>s.code===scenario);
  if(scenario!=='actual'&&!selected)return json({error:'Unknown activity scenario'},400);
  if(selected){for(const rule of rules.rows.filter(r=>r.day_class===selected.code)){
    if(rule.adjustment_type!=='override')continue;
    const key=map[rule.nutrient];if(!key)continue;
    let factor=1;
    if(rule.calculation_mode==='g_per_kg'&&rule.weight_basis==='goal_weight'){if(v.goal_weight_kg==null)continue;factor=Number(v.goal_weight_kg);}
    else if(rule.calculation_mode!=='grams')continue;
    targets[key]={min:rule.value_min==null?null:Number(rule.value_min)*factor,center:rule.value_center==null?null:Number(rule.value_center)*factor,max:rule.value_max==null?null:Number(rule.value_max)*factor};
  }}
  const sums=intakes.rows[0]||{};
  const actual={energy:sums.energy,protein:sums.protein,carbs:sums.carbs,fat:sums.fat,fiber:sums.fiber};
  return json({plan:{version:v.version,effective_from:v.effective_from,label:'坏女人当前生效计划'},day_class_label:selected?.label||(activities.rows.length?'实际运动类型待核实':'尚无已确认运动分类'),scenarios,targets,actual,actual_verified:false});
}

export default {async fetch(request){
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  const path=new URL(request.url).pathname;
  if(path==='/health'&&request.method==='GET')return json({ok:true,service:'duofit-intake',authenticated:false});
  try{
    if(request.method==='POST'&&request.headers.get('origin')!==ORIGIN)return json({error:'Origin not permitted'},403);
    if(request.method==='POST'&&path==='/api/device/register')return await registerDevice(request);
    if(request.method==='GET'&&path==='/api/device/status')return await deviceStatus(request);
    if(!await checkAuth(request))return json({error:'Unauthorized or device not approved'},401);
    if(request.method==='POST'&&path==='/api/submissions')return await submitIntake(request);
    if(request.method==='POST'&&path==='/api/measurements')return await submitMeasurement(request);
    if(request.method==='POST'&&path==='/api/activities')return await submitActivity(request);
    if(request.method==='POST'&&path==='/api/activity-images')return await uploadImage(request);
    if(request.method==='GET'&&path==='/api/submissions')return await listSubmissions(request);
    if(request.method==='GET'&&path==='/api/nutrition/overview')return await nutritionOverview(request);
    return json({error:'Not found'},404);
  }catch(e){console.error('DuoFit API request failed',e.message);return json({error:'Request failed'},500);}
}};
