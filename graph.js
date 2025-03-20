// Load both data files
Promise.all([
    d3.json('semantic_graph.json'),
    d3.json('clean_survey_data.json')
]).then(([graphData, surveyData]) => {
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Create SVG with zoom support
    const svg = d3.select("#graph")
        .append("svg")
        .attr("width", width)
        .attr("height", height);

    // Add zoom behavior
    const g = svg.append("g");
    const zoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on("zoom", (event) => {
            g.attr("transform", event.transform);
        });

    svg.call(zoom);

    // Add this after the SVG creation
    svg.style("pointer-events", "auto");
    g.style("pointer-events", "auto");

    // Calculate node sizes based on sample size
    const maxSampleSize = Math.max(...Object.values(surveyData).map(d => d["Sample Size"]));
    const sizeScale = d3.scaleSqrt()
        .domain([0, maxSampleSize])
        .range([5, 30]);

    // Define confidence color scale - reduced to 3 levels
    const confidenceColors = ["#C4ECD8", "#77BB99", "#04BD61"];
    
    // Function to calculate confidence score
    function calculateConfidence(surveyData, topicId) {
        if (!surveyData[topicId] || !surveyData[topicId].Questions) return 0;
        
        // Get the first question (most surveys have only one)
        const questionKey = Object.keys(surveyData[topicId].Questions)[0];
        if (!questionKey) return 0;
        
        const options = surveyData[topicId].Questions[questionKey];
        if (!options || !options.length) return 0;
        
        // Sort options by percentage in descending order
        const sortedOptions = [...options].sort((a, b) => b.Percentage - a.Percentage);
        
        // Calculate confidence as top response minus sum of rest
        const topResponse = sortedOptions[0].Percentage;
        const sumOfRest = sortedOptions.slice(1).reduce((sum, opt) => sum + opt.Percentage, 0);
        
        return topResponse - sumOfRest;
    }
    
    // Function to get color based on confidence - now with 3 levels
    function getConfidenceColor(confidence) {
        if (confidence <= 0) return confidenceColors[0];
        if (confidence < 0.33) return confidenceColors[0];
        if (confidence < 0.66) return confidenceColors[1];
        return confidenceColors[2];
    }

    // Create force simulation
    const simulation = d3.forceSimulation(graphData.nodes)
        .force("link", d3.forceLink(graphData.links)
            .id(d => d.id)
            .strength(d => d.strength * 0.1))
        .force("charge", d3.forceManyBody().strength(-100))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(d => sizeScale(surveyData[d.id]?.["Sample Size"] || 0) + 2));

    // Create links
    const links = g.append("g")
        .selectAll("line")
        .data(graphData.links)
        .join("line")
        .attr("class", "link")
        .style("stroke-width", d => d.strength * 2);

    // Create node groups
    const nodeGroups = g.append("g")
        .selectAll("g")
        .data(graphData.nodes)
        .join("g")
        .attr("class", "node-group")
        .call(drag(simulation));

    // First add circles to node groups
    const nodes = nodeGroups
        .append("circle")
        .attr("class", "node")
        .attr("r", d => sizeScale(surveyData[d.id]?.["Sample Size"] || 0))
        .style("fill", d => {
            const confidence = calculateConfidence(surveyData, d.id);
            return getConfidenceColor(confidence);
        })
        .style("color", d => {
            const confidence = calculateConfidence(surveyData, d.id);
            return getConfidenceColor(confidence);
        });

    // Then add labels to node groups
    const labels = nodeGroups
        .append("text")
        .attr("class", "node-label")
        .attr("dy", d => -sizeScale(surveyData[d.id]?.["Sample Size"] || 0) - 10)
        .text(d => d.id);

    // Finally add label backgrounds to node groups
    const labelBgs = nodeGroups
        .append("rect")
        .attr("class", "node-label-bg")
        .attr("y", d => -sizeScale(surveyData[d.id]?.["Sample Size"] || 0) - 25) // Position above node
        .attr("height", 30)
        .attr("x", d => {
            const textLength = d.id.length * 7; // Slightly wider for better fit
            return -textLength/2 - 8; // Center and add padding
        })
        .attr("width", d => d.id.length * 7 + 16); // Width based on text length + padding

    // Handle popup
    const popup = d3.select("#popup").html("");

    // Add this after initializing the popup to ensure proper styling
    popup.style("background", "rgba(31, 31, 31, 0.97)")  // Explicitly set background
         .style("mix-blend-mode", "normal")              // Reset any blend mode
         .style("filter", "none");                       // Remove any filters

    nodes.on("click", (event, d) => {
        const surveyInfo = surveyData[d.id];
        if (!surveyInfo) return;

        // Clear search input and reset highlights
        document.getElementById('search-input').value = '';
        nodes.classed('highlighted', false)
             .classed('dimmed', false);
        links.classed('dimmed', false);

        // Remove selected class from all nodes
        nodes.classed("selected", false);
        
        // Add selected class to clicked node
        d3.select(event.currentTarget).classed("selected", true);

        // Get the first question (most surveys have only one)
        const questionKey = Object.keys(surveyInfo.Questions)[0];
        const options = surveyInfo.Questions[questionKey];
        
        // Calculate confidence score
        const confidence = calculateConfidence(surveyData, d.id);

        // Completely reset the popup element
        const popupElement = document.getElementById("popup");
        popupElement.innerHTML = "";
        
        // Create the popup content structure
        const popupContent = document.createElement("div");
        popupContent.className = "popup-content";
        
        const question = document.createElement("div");
        question.className = "question";
        question.textContent = questionKey;
        popupContent.appendChild(question);
        
        const optionsContainer = document.createElement("div");
        optionsContainer.className = "options-container";
        
        // Add options with letters
        options.forEach((option, index) => {
            const letter = String.fromCharCode(97 + index); // 97 is ASCII for 'a'
            
            const optionDiv = document.createElement("div");
            optionDiv.className = "option";
            
            const optionText = document.createElement("div");
            optionText.className = "option-text";
            
            const letterSpan = document.createElement("span");
            letterSpan.className = "option-letter";
            letterSpan.textContent = letter + ".";
            optionText.appendChild(letterSpan);
            
            optionText.appendChild(document.createTextNode(" " + option.Option));
            
            const optionPercent = document.createElement("div");
            optionPercent.className = "option-percent";
            optionPercent.textContent = (option.Percentage * 100).toFixed(1) + "%";
            
            optionDiv.appendChild(optionText);
            optionDiv.appendChild(optionPercent);
            optionsContainer.appendChild(optionDiv);
        });
        
        popupContent.appendChild(optionsContainer);
        popupElement.appendChild(popupContent);
        
        // Add footer
        const footer = document.createElement("div");
        footer.className = "popup-footer";
        
        const surveyName = document.createElement("p");
        surveyName.textContent = surveyInfo["Survey Name"];
        
        const sampleSize = document.createElement("p");
        sampleSize.textContent = surveyInfo["Sample Size"] + " responses";
        
        footer.appendChild(surveyName);
        footer.appendChild(sampleSize);
        popupElement.appendChild(footer);
        
        // Add close button
        const closeBtn = document.createElement("div");
        closeBtn.className = "close-btn";
        closeBtn.textContent = "×";
        closeBtn.addEventListener("click", (e) => {
            popupElement.style.animation = "none";
            popupElement.style.transition = "none";
            popupElement.style.display = "none";
            
            // Force a reflow to ensure styles are applied immediately
            void popupElement.offsetWidth;
            
            nodes.classed("selected", false);
            document.body.classList.remove("popup-visible");
            e.stopPropagation();
        });
        
        popupElement.appendChild(closeBtn);
        
        // Display the popup with animations disabled
        popupElement.style.display = "block";
        popupElement.style.animation = "none";
        popupElement.style.transition = "none";
        
        // Force a reflow to ensure styles are applied immediately
        void popupElement.offsetWidth;
        
        // Add class to body to hide all labels when popup is visible
        document.body.classList.add("popup-visible");
        
        // Explicitly hide all label backgrounds immediately
        labelBgs.style("opacity", 0)
               .style("transition", "none")
               .style("animation", "none");
        
        labels.style("opacity", 0)
             .style("transition", "none")
             .style("animation", "none");
        
        // Stop event propagation
        event.stopPropagation();
    });

    // Update the document click handler to also remove selected class
    svg.on("click", () => {
        popup.style("display", "none");
        document.body.classList.remove("popup-visible");
        nodes.classed("selected", false);
    });

    // Update positions on simulation tick
    simulation.on("tick", () => {
        links
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

        nodeGroups
            .attr("transform", d => `translate(${d.x},${d.y})`);
    });

    // Drag functionality
    function drag(simulation) {
        function dragstarted(event) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            event.subject.fx = event.subject.x;
            event.subject.fy = event.subject.y;
        }

        function dragged(event) {
            event.subject.fx = event.x;
            event.subject.fy = event.y;
        }

        function dragended(event) {
            if (!event.active) simulation.alphaTarget(0);
            event.subject.fx = null;
            event.subject.fy = null;
        }

        return d3.drag()
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended);
    }

    // Alternative approach using string splitting for exact word matching
    function containsExactWord(text, word) {
        if (!text || !word) return false;
        const words = text.toLowerCase().split(/\s+/);
        return words.includes(word.toLowerCase());
    }

    // Fix the search functionality to ensure only exact matches are highlighted
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', function() {
        const searchTerm = this.value.toLowerCase().trim();
        
        if (searchTerm === '') {
            // Reset all nodes and links
            nodes.classed('highlighted', false)
                 .classed('dimmed', false);
            links.classed('dimmed', false);
            return;
        }
        
        // Check each node for match
        const matchingNodes = [];
        nodes.each(function(d) {
            const nodeData = surveyData[d.id];
            
            // Check for match in topic name
            let isMatch = containsExactWord(d.id, searchTerm);
            
            // If not matched in topic name, search in questions and responses
            if (!isMatch && nodeData && nodeData.Questions) {
                // Search in questions
                const questions = Object.keys(nodeData.Questions);
                isMatch = questions.some(q => containsExactWord(q, searchTerm));
                
                // Search in responses
                if (!isMatch) {
                    isMatch = questions.some(q => {
                        const options = nodeData.Questions[q];
                        return options.some(opt => 
                            containsExactWord(opt.Option, searchTerm)
                        );
                    });
                }
            }
            
            // Apply classes based on match
            d3.select(this)
                .classed('highlighted', isMatch)
                .classed('dimmed', !isMatch);
            
            if (isMatch) {
                matchingNodes.push(d.id);
            }
        });
        
        // Dim links that don't connect to matching nodes
        links.classed('dimmed', function(d) {
            return !matchingNodes.includes(d.source.id) && !matchingNodes.includes(d.target.id);
        });
    });

    // Clear search when clicking on graph background
    svg.on('click', function(event) {
        // Only handle clicks directly on the SVG, not on nodes
        if (event.target === this) {
            searchInput.value = '';
            nodes.classed('highlighted', false)
                 .classed('dimmed', false);
            links.classed('dimmed', false);
            popup.style("display", "none");
            document.body.classList.remove("popup-visible");
            nodes.classed("selected", false);
        }
    });

    // Update the CSS for dimmed nodes and links
    const style = document.createElement('style');
    style.textContent = `
      .node.dimmed {
        opacity: 0.1 !important; /* 10% opacity for non-highlighted nodes */
      }
      
      .link.dimmed {
        opacity: 0.05 !important; /* Even less visible links */
      }
    `;
    document.head.appendChild(style);
}); 