import { Client } from "@gradio/client";
	
	const client = await Client.connect("codeignite/whatsappText");
	const result = await client.predict("/respond", { 		
			message: "Write python code to teach recursion", 
								
			system_message: "You are the CodeIgnite AI tutor. Help students learn coding by being encouraging and clear.", 
								
			max_tokens: 512, 
								
			temperature: 0.7, 
								
			top_p: 0.95, 
						
	});

	console.log(result.data);
	