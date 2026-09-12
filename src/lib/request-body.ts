export async function readJson(request: Request, limit=32_000) {
  const reader=request.body?.getReader();
  if (!reader) throw new Error('A JSON request body is required.');
  const chunks:Uint8Array[]=[];let size=0;
  try {
    while(true) {
      const {done,value}=await reader.read();if(done)break;
      size+=value.length;
      if(size>limit){await reader.cancel();throw new Error('Request is too large.');}
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
