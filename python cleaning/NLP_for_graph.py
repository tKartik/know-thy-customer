from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
import json
import os
import networkx as nx
from collections import Counter
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

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

    # Create a NetworkX graph for community detection
    print("Performing community detection...")
    G = nx.Graph()
    
    # Add nodes to the graph
    for node in nodes:
        G.add_node(node["id"], **node)
    
    # Add edges to the graph with weights based on similarity strength
    for link in links:
        G.add_edge(link["source"], link["target"], weight=link["strength"])
    
    # Use Louvain community detection algorithm
    communities = nx.community.louvain_communities(G, weight='weight')
    
    print(f"Found {len(communities)} communities/clusters")
    
    # Function to generate a meaningful label for each cluster
    def generate_cluster_label(community_nodes):
        # Extract question texts and topics for this community
        community_texts = [G.nodes[node_id]["id"] for node_id in community_nodes]
        community_topics = [G.nodes[node_id].get("topic", "Unknown") for node_id in community_nodes]
        
        # Filter out "Unknown" topics
        valid_topics = [topic for topic in community_topics if topic != "Unknown"]
        
        # If we have very few nodes, use the most common topic or the question itself
        if len(community_nodes) < 3:
            if valid_topics:
                most_common_topic = Counter(valid_topics).most_common(1)[0][0]
                return most_common_topic
            else:
                # Use the first question if it's short, otherwise truncate
                question = community_texts[0]
                if len(question) <= 30:
                    return question
                else:
                    return question[:27] + "..."
        
        # First strategy: Look for common themes in topic fields
        if valid_topics:
            # Extract key theme words from topics
            topic_words = []
            for topic in valid_topics:
                words = topic.lower().split()
                topic_words.extend([w for w in words if len(w) > 3])
            
            # Count occurrences of theme words
            topic_word_counts = Counter(topic_words)
            common_themes = [word.capitalize() for word, count in topic_word_counts.most_common(3) 
                            if count >= max(2, len(community_nodes) / 5)]
            
            if common_themes:
                # Use just the most common theme instead of combining with conjunction
                return common_themes[0]
        
        # Second strategy: Use TF-IDF for key terms but create more natural labels
        vectorizer = TfidfVectorizer(
            max_features=50, 
            stop_words='english',
            ngram_range=(1, 2),  # Include both single words and bigrams
            min_df=1,  # Term must appear in at least 1 document
            max_df=0.9  # Ignore terms that appear in 90%+ of documents
        )
        
        # Handle case where all texts are identical
        unique_texts = list(set(community_texts))
        if len(unique_texts) == 1:
            # For a single unique text, extract key phrases
            words = unique_texts[0].split()
            if len(words) > 5:
                # Take first 5 words if long enough
                return " ".join(words[:5]) + "..."
            else:
                return unique_texts[0]
        
        # Define clearer domain categories for better labeling
        domain_categories = {
            'Investment Portfolio': ['invest', 'investment', 'portfolio', 'return', 'stock', 'equity', 'mutual', 'fund', 'sip'],
            'Investment Assets': ['gold', 'real estate', 'property', 'land', 'flat', 'house'],
            'Digital Banking': ['bank', 'account', 'payment', 'upi', 'transfer', 'digital', 'online', 'app', 'mobile'],
            'Payment Methods': ['credit', 'debit', 'card', 'cash', 'upi', 'payment'],
            'Loan Management': ['loan', 'emi', 'mortgage', 'interest', 'borrow', 'repayment', 'debt'],
            'Credit Health': ['cibil', 'credit score', 'rating'],
            'Financial Planning': ['saving', 'retirement', 'insurance', 'tax', 'budget', 'financial goal', 'emergency fund'],
            'Market Analysis': ['market', 'sensex', 'nifty', 'index', 'trading', 'analysis', 'research'],
            'Economic Factors': ['inflation', 'economic', 'growth', 'recession'],
            'Spending Behavior': ['spend', 'expense', 'purchase', 'shopping', 'subscription', 'premium'],
            'Financial Decisions': ['prefer', 'choice', 'opinion', 'better', 'selection', 'decision']
        }
        
        # Try to identify the dominant domain
        domain_scores = {}
        for domain, keywords in domain_categories.items():
            score = 0
            for text in community_texts:
                text_lower = text.lower()
                for keyword in keywords:
                    if keyword in text_lower:
                        score += 1
            domain_scores[domain] = score
        
        # Get the dominant domain if any
        max_score = max(domain_scores.values())
        if max_score > 0:
            dominant_domains = [domain for domain, score in domain_scores.items() if score == max_score]
            if len(dominant_domains) == 1:
                dominant_domain = dominant_domains[0]
            else:
                # If tied, prefer more specific domains over general ones
                for preferred in ['Credit Health', 'Loan Management', 'Payment Methods', 'Digital Banking', 
                                'Investment Assets', 'Investment Portfolio', 'Market Analysis', 'Economic Factors', 
                                'Spending Behavior', 'Financial Planning', 'Financial Decisions']:
                    if preferred in dominant_domains:
                        dominant_domain = preferred
                        break
                else:
                    dominant_domain = dominant_domains[0]
        else:
            dominant_domain = None
        
        try:
            # Extract key terms using TF-IDF
            X = vectorizer.fit_transform(community_texts)
            feature_names = vectorizer.get_feature_names_out()
            importance = np.mean(X.toarray(), axis=0)
            
            # Get top terms
            indices = importance.argsort()[-5:][::-1]  # Get top 5 to have more options
            top_terms = [feature_names[i] for i in indices]
            
            # Filter out generic question words
            generic_terms = ["what", "which", "when", "how", "why", "is", "are", "do", "does", "would", "will", "have", "has", "can"]
            filtered_terms = [term for term in top_terms if term.lower() not in generic_terms and len(term) > 3]
            
            # If we have a dominant domain, it's usually sufficient on its own
            if dominant_domain:
                # In most cases, just return the domain as the label
                return dominant_domain
            
            # Without a dominant domain, use the most significant term
            if filtered_terms:
                return filtered_terms[0].capitalize()
            
            # Final fallback
            return f"Cluster {len(community_nodes)}"
            
        except Exception as e:
            print(f"Error generating label: {e}")
            # Fallback to a simple label
            return f"Cluster {len(community_nodes)}"
    
    # Assign clusters and labels to nodes
    cluster_labels = {}
    for i, community in enumerate(communities):
        label = generate_cluster_label(community)
        cluster_labels[i] = label
        print(f"Cluster {i+1}: {label} ({len(community)} nodes)")
        
        # Add cluster info to nodes
        for node_id in community:
            for node in nodes:
                if node["id"] == node_id:
                    node["cluster_id"] = i
                    node["cluster_label"] = label
                    break
    
    # Add cluster info to the final graph data
    graph_data = {
        "nodes": nodes, 
        "links": links,
        "clusters": [
            {"id": i, "label": label, "size": len(communities[i])} 
            for i, label in cluster_labels.items()
        ]
    }

    # Save the JSON graph file to the current directory
    output_path = os.path.join(script_dir, "semantic_graph.json")
    print(f"Saving output to: {output_path}")
    
    # Also save a copy to the src/data directory for the visualization
    src_data_dir = os.path.abspath(os.path.join(script_dir, "../src/data"))
    if not os.path.exists(src_data_dir):
        os.makedirs(src_data_dir)
    src_output_path = os.path.join(src_data_dir, "semantic_graph.json")
    
    # Save to both locations
    with open(output_path, "w") as json_file:
        json.dump(graph_data, json_file, indent=4)
        
    with open(src_output_path, "w") as json_file:
        json.dump(graph_data, json_file, indent=4)

    print("Graph JSON saved as semantic_graph.json")
    print(f"Created {len(nodes)} nodes, {len(links)} connections, and {len(communities)} labeled clusters")
    
    # Print the cluster labels for verification
    print("\nCluster Labels Summary:")
    for i, label in cluster_labels.items():
        print(f"Cluster {i+1}: {label} ({len(communities[i])} nodes)")

except FileNotFoundError as e:
    print(f"Error: {e}")
except json.JSONDecodeError:
    print("Error: Invalid JSON format in clean_survey_data.json")
except Exception as e:
    print(f"An unexpected error occurred: {e}")
