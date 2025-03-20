from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
import json
import os

try:
    # Load pre-trained BERT model for embeddings
    print("Loading BERT model...")
    model = SentenceTransformer("all-MiniLM-L6-v2")

    # Load JSON file
    print("Loading JSON data...")
    with open("clean_survey_data.json", "r") as f:
        data = json.load(f)

    # Extract topics from the dataset
    topics = list(data.keys())
    print(f"Found {len(topics)} topics")

    # Generate embeddings for each topic
    print("Generating embeddings...")
    topic_embeddings = model.encode(topics)

    # Compute cosine similarity between topics
    similarity_matrix = cosine_similarity(topic_embeddings)

    # Convert similarity scores into graph format (nodes & links)
    nodes = [{"id": topic, "size": 1} for topic in topics]

    # Define links based on a similarity threshold
    links = []
    threshold = 0.5  # Adjust this for stronger/weaker connections

    for i in range(len(topics)):
        for j in range(i + 1, len(topics)):  # Avoid duplicate comparisons
            if similarity_matrix[i][j] > threshold:
                links.append({
                    "source": topics[i],
                    "target": topics[j],
                    "strength": round(float(similarity_matrix[i][j]), 2)  # Round for readability
                })

    # Create the final graph structure for D3.js
    graph_data = {"nodes": nodes, "links": links}

    # Save the JSON graph file
    with open("semantic_graph.json", "w") as json_file:
        json.dump(graph_data, json_file, indent=4)

    print("Graph JSON saved as semantic_graph.json")

except FileNotFoundError as e:
    print(f"Error: {e}")
except json.JSONDecodeError:
    print("Error: Invalid JSON format in clean_survey_data.json")
except Exception as e:
    print(f"An unexpected error occurred: {e}")
