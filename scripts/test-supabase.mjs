import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing env vars")
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function test() {
  console.log("Testing connection to:", supabaseUrl)
  
  const { data: buckets, error: bucketError } = await supabase.storage.listBuckets()
  
  if (bucketError) {
    console.error("Error listing buckets:", bucketError)
  } else {
    console.log("Buckets found:", buckets.map(b => b.name))
    const exists = buckets.find(b => b.name === 'videos-estoque')
    if (exists) {
      console.log("Bucket 'videos-estoque' exists!")
    } else {
      console.log("Bucket 'videos-estoque' DOES NOT exist!")
    }
  }
}

test()
