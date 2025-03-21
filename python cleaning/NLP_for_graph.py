from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
import json
import os

try:
    # Get the current script's directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Load pre-trained BERT model for embeddings
    print("Loading BERT model...")
    model = SentenceTransformer("all-MiniLM-L6-v2")

    # Load JSON file
    print("Loading JSON data...")
    json_path = os.path.join(script_dir, "clean_survey_data.json")
    print(f"Looking for JSON file at: {json_path}")
    with open(json_path, "r") as f:
        data = json.load(f)

    # Create a list of question-options pairs with their metadata
    question_data = []
    question_texts = []
    
    # Process the new structure where questions are the main keys
    for question, question_data_obj in data.items():
        # Combine question with its options for semantic analysis
        options_text = " | ".join([resp["Option"] for resp in question_data_obj["Responses"]])
        combined_text = f"{question} - {options_text}"
        
        question_texts.append(combined_text)
        question_data.append({
            "question": question,
            "options": options_text,
            # Still store these for reference in output, even though they won't affect connections
            "topic": question_data_obj.get("Topic", "Unknown"),
            "sample_size": question_data_obj.get("Sample Size", 0),
            "survey_name": question_data_obj.get("Survey Name", "Unknown")
        })

    print(f"Found {len(question_texts)} questions")

    # Generate embeddings for each question-options combination
    print("Generating embeddings...")
    embeddings = model.encode(question_texts)

    # Compute cosine similarity between questions
    similarity_matrix = cosine_similarity(embeddings)

    # Convert similarity scores into graph format (nodes & links)
    nodes = []
    for i, qdata in enumerate(question_data):
        nodes.append({
            "id": qdata["question"],
            "options": qdata["options"],
            # Include these for reference only
            "topic": qdata["topic"],
            "size": qdata["sample_size"] if qdata["sample_size"] else 1,
            "survey_name": qdata["survey_name"]
        })

    # Define links based on a similarity threshold
    links = []
    threshold = 0.5  # Adjust this for stronger/weaker connections

    for i in range(len(question_texts)):
        for j in range(i + 1, len(question_texts)):
            if similarity_matrix[i][j] > threshold:
                links.append({
                    "source": question_data[i]["question"],
                    "target": question_data[j]["question"],
                    "strength": round(float(similarity_matrix[i][j]), 2)
                    # Removed sourceTopic and targetTopic as they're not needed for connections
                })

    # Create the final graph structure for D3.js
    graph_data = {"nodes": nodes, "links": links}

    # Save the JSON graph file to the current directory
    output_path = os.path.join(script_dir, "semantic_graph_final.json")
    print(f"Saving output to: {output_path}")
    with open(output_path, "w") as json_file:
        json.dump(graph_data, json_file, indent=4)

    print("Graph JSON saved as semantic_graph_final.json")
    print(f"Created {len(nodes)} nodes and {len(links)} connections")

except FileNotFoundError as e:
    print(f"Error: {e}")
except json.JSONDecodeError:
    print("Error: Invalid JSON format in clean_survey_data.json")
except Exception as e:
    print(f"An unexpected error occurred: {e}")
