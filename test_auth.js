import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function runTest() {
  const email = `testuser_${Date.now()}@example.com`;
  const password = 'password123';

  console.log(`Signing up ${email}...`);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: 'Test User'
      }
    }
  });

  if (error) {
    console.error('Signup error:', error.message);
    return;
  }

  console.log('Signup success. User ID:', data.user.id);
  
  console.log('Checking profile created by trigger...');
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single();

  if (profileError) {
    console.error('Fetch profile error:', profileError);
    
    console.log('Attempting to insert profile manually...');
    const { error: insertError } = await supabase
        .from('profiles')
        .insert([{
            id: data.user.id,
            full_name: 'Test User Fallback',
            email: email,
            phone: null,
        }]);
        
    if (insertError) {
        console.error('Insert profile error:', insertError);
    } else {
        console.log('Manual insert succeeded.');
    }
  } else {
    console.log('Profile created successfully by trigger:', profile);
  }
}

runTest();
