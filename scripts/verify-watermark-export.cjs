// Run after generating the native branded PNG: node scripts/verify-watermark-export.cjs /path/to/brand.png [output-directory]
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const ts=require('typescript');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const brand=process.argv[2];
if(!brand)throw new Error('Pass a PNG containing the logo, 60Seconds and creator username');
const directory=process.argv[3]||fs.mkdtempSync(path.join(os.tmpdir(),'watermark-export-'));
fs.mkdirSync(directory,{recursive:true});
const exportsObject={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('utils/watermark-layout.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:exportsObject});
const {watermarkFFmpegFilter,watermarkCorner,watermarkWidth}=exportsObject;
function ffmpeg(args){return execFileSync('ffmpeg',['-v','error','-threads','2',...args],{maxBuffer:16*1024*1024});}
function probe(file){return JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',file],{encoding:'utf8'})).streams;}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const [name,width,height,duration]of [['portrait',360,640,17],['landscape',640,360,17],['square',480,480,17],['short',360,640,0.5]]){
 const source=path.join(directory,`${name}-source.mp4`),output=path.join(directory,`${name}-watermarked.mp4`);
 ffmpeg(['-y','-f','lavfi','-i',`color=c=0x17202c:s=${width}x${height}:r=30:d=${duration}`,'-f','lavfi','-i',`sine=frequency=440:duration=${duration}`,'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',source]);
 ffmpeg(['-y','-i',source,'-i',brand,'-filter_complex',watermarkFFmpegFilter(watermarkWidth(Math.min(width,height))),'-map','[v]','-map','0:a:0?','-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',output]);
 const before=probe(source),after=probe(output),video=after.find(s=>s.codec_type==='video');
 assert.equal(video.width,width);assert.equal(video.height,height);assert.equal(video.r_frame_rate,'30/1');
 assert.ok(Math.abs(Number(video.duration)-duration)<0.04,`${name} duration is preserved`);
 assert.equal(after.filter(s=>s.codec_type==='audio').length,before.filter(s=>s.codec_type==='audio').length);
 assert.equal(hash(ffmpeg(['-i',source,'-map','0:a:0','-c:a','copy','-f','adts','pipe:1'])),hash(ffmpeg(['-i',output,'-map','0:a:0','-c:a','copy','-f','adts','pipe:1'])));
 for(const second of duration<1?[0]:[0,4,8,12,16]){
  const pixels=ffmpeg(['-ss',String(second),'-i',output,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);
  const center = (Math.floor(height/2)*width+Math.floor(width/2))*3;
  for(const [channel,expected] of [22,31,45].entries()) assert.ok(Math.abs(pixels[center+channel]-expected)<8,`${name} original background pixels survive the export`);
  let count=0,sumX=0,sumY=0;
  for(let i=0;i<pixels.length;i+=3)if(pixels[i]>100&&pixels[i+1]>100&&pixels[i+2]>100){count++;sumX+=(i/3)%width;sumY+=Math.floor(i/3/width);}
  assert.ok(count>10,`${name} has visible watermark pixels at ${second}s`);
  const corner=watermarkCorner(second);
  assert.equal(sumX/count>width/2,corner.x>0.5,`${name} horizontal corner at ${second}s`);
  assert.equal(sumY/count>height/2,corner.y>0.5,`${name} vertical corner at ${second}s`);
 }
 console.log(`${name}: watermark visible at each corner; ${width}x${height}, 30 fps and identical AAC preserved: ${output}`);
}
