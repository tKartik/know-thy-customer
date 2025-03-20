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
    
    // Create separate layer for tooltips that will always stay on top
    const tooltipLayer = svg.append("g")
        .attr("class", "tooltip-layer")
        .style("pointer-events", "none");
        
    // Connect tooltip layer to main zoom transform
    const zoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on("zoom", (event) => {
            // Update graph transform
            g.attr("transform", event.transform);
            
            // Also apply transform to tooltip layer
            tooltipLayer.attr("transform", event.transform);
            
            // Adjust label size based on zoom scale - improved responsiveness
            const scale = event.transform.k;
            
            // Hide labels at extreme zoom levels
            const labelVisibility = scale < 0.2 ? 'none' : 'visible';
            
            // Calculate text size first - this affects backgrounds
            g.selectAll(".cluster-label")
                .style("display", labelVisibility)
                .style("font-size", `${Math.min(20, Math.max(12, 16/scale))}px`) // Constrain size
                .style("opacity", scale < 0.5 ? (scale * 2) : 1)
                .style("font-weight", scale < 0.7 ? "bold" : "900"); // Bolder at smaller scales
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

    // New function to calculate node color based on answer distribution
    function calculateNodeColor(surveyData, topicId) {
        if (!surveyData[topicId] || !surveyData[topicId].Questions) return "#C4ECD8";
        
        // Get the first question (most surveys have only one)
        const questionKey = Object.keys(surveyData[topicId].Questions)[0];
        if (!questionKey) return "#C4ECD8";
        
        const options = surveyData[topicId].Questions[questionKey];
        if (!options || !options.length) return "#C4ECD8";
        
        // Sort options by percentage in descending order
        const sortedOptions = [...options].sort((a, b) => b.Percentage - a.Percentage);
        
        // Get highest percentage
        const topPercentage = sortedOptions[0].Percentage;
        
        // Create a blend between saturated lime green (#5CFF5C) and white (#FFFFFF)
        // based on the top answer's percentage
        const limeGreen = {r: 92, g: 255, b: 92}; // #5CFF5C - Lime green
        const white = {r: 255, g: 255, b: 255}; // #FFFFFF - White
        
        // Linear interpolation between white and lime green based on top percentage
        const red = Math.round(white.r - (white.r - limeGreen.r) * topPercentage);
        const green = Math.round(white.g - (white.g - limeGreen.g) * topPercentage);
        const blue = Math.round(white.b - (white.b - limeGreen.b) * topPercentage);
        
        return `rgb(${red}, ${green}, ${blue})`;
    }

    // Create force simulation - MODIFIED FORCES TO KEEP CLUSTERS CLOSER TO CENTER
    const simulation = d3.forceSimulation(graphData.nodes)
        .force("link", d3.forceLink(graphData.links)
            .id(d => d.id)
            .strength(d => d.strength * 0.08)) // Reduced from 0.1 to 0.08
        .force("charge", d3.forceManyBody()
            .strength(-200)) // Reduced repulsive force from -100 to -80
        .force("center", d3.forceCenter(width / 2, height / 2)
            .strength(0.12)) // Increased center attraction force (default is 0.1)
        .force("collision", d3.forceCollide()
            .radius(d => sizeScale(surveyData[d.id]?.["Sample Size"] || 0) + 2)
            .strength(1)) // Increased collision strength to prevent overlap
        .force("x", d3.forceX(width / 2).strength(0.08)) // Added X-force to keep nodes centered horizontally
        .force("y", d3.forceY(height / 2).strength(0.08)); // Added Y-force to keep nodes centered vertically

    // Simple community detection using link strengths
    // Create an adjacency map
    const adjacencyMap = {};
    graphData.nodes.forEach(node => {
        adjacencyMap[node.id] = [];
    });
    
    graphData.links.forEach(link => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        
        adjacencyMap[sourceId].push({id: targetId, strength: link.strength});
        adjacencyMap[targetId].push({id: sourceId, strength: link.strength});
    });
    
    // Simple greedy community detection
    // Start with high threshold, then reduce
    const communities = [];
    const assignedNodes = new Set();
    const thresholds = [0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2];
    
    thresholds.forEach(threshold => {
        graphData.nodes.forEach(node => {
            if (assignedNodes.has(node.id)) return;
            
            // Find strongly connected neighbors
            const community = [node.id];
            assignedNodes.add(node.id);
            
            const connections = adjacencyMap[node.id] || [];
            connections.forEach(conn => {
                if (conn.strength >= threshold && !assignedNodes.has(conn.id)) {
                    community.push(conn.id);
                    assignedNodes.add(conn.id);
                }
            });
            
            if (community.length > 1) {
                communities.push(community);
            }
        });
    });
    
    // Assign remaining nodes to their own community
    graphData.nodes.forEach(node => {
        if (!assignedNodes.has(node.id)) {
            communities.push([node.id]);
            assignedNodes.add(node.id);
        }
    });
    
    // Assign cluster names based on common themes
    const clusterLabels = [];
    communities.forEach((community, index) => {
        if (community.length < 2) return; // Skip small communities
        
        // Extract question topics from survey data
        const topicWords = {};
        community.forEach(nodeId => {
            const nodeData = surveyData[nodeId];
            if (!nodeData || !nodeData.Questions) return;
            
            // Get question text
            const questions = Object.keys(nodeData.Questions);
            questions.forEach(question => {
                // Extract key financial terms
                const keyTerms = [
                    "investment", "bank", "financial", "loan", "credit", 
                    "money", "mortgage", "savings", "income", "expense",
                    "housing", "property", "payment", "stock", "fund", 
                    "insurance", "budget", "finance", "debt", "purchase"
                ];
                
                // Find matching terms in question
                keyTerms.forEach(term => {
                    if (question.toLowerCase().includes(term)) {
                        topicWords[term] = (topicWords[term] || 0) + 1;
                    }
                });
                
                // If no key terms found, extract nouns from node ID
                if (Object.keys(topicWords).length === 0) {
                    const nodeWords = nodeId.split(/[\s\/\-&]+/).filter(w => w.length > 3);
                    nodeWords.forEach(word => {
                        if (word.match(/^[A-Z]/)) {
                            word = word.toLowerCase();
                            topicWords[word] = (topicWords[word] || 0) + 1;
                        }
                    });
                }
            });
        });
        
        // Get most common topic words
        const commonTopics = Object.entries(topicWords)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2)
            .map(entry => entry[0]);
        
        // Create label prioritizing financial terms
        let label = '';
        if (commonTopics.length > 0) {
            label = commonTopics[0].charAt(0).toUpperCase() + commonTopics[0].slice(1);
            if (commonTopics.length > 1 && label.length + commonTopics[1].length < 12) {
                label += ' ' + commonTopics[1];
            }
        } else if (community.length > 0) {
            // Fallback to first word of first node
            const firstNode = community[0].split(/[\s\/\-&]+/)[0];
            label = firstNode;
        }
        
        // For investment-focused clusters, ensure "Investment" is in the label
        const hasInvestmentNode = community.some(nodeId => 
            nodeId.toLowerCase().includes("invest") || 
            (surveyData[nodeId]?.Questions && 
             Object.keys(surveyData[nodeId].Questions).some(q => q.toLowerCase().includes("invest")))
        );
        
        if (hasInvestmentNode && !label.toLowerCase().includes("invest")) {
            label = "Investment";
        }
        
        // Store cluster info
        clusterLabels.push({
            id: 'cluster-' + index,
            nodes: community,
            label: label,
            x: 0,
            y: 0
        });
    });
    
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
            // Use new color calculation function instead of confidence-based color
            return calculateNodeColor(surveyData, d.id);
        })
        .style("color", d => {
            // Use same color for glow/shadow effect
            return calculateNodeColor(surveyData, d.id);
        });
        
    // Create a mapping of nodes to create tooltips in the top layer
    const nodeTooltipGroups = tooltipLayer.selectAll("g")
        .data(graphData.nodes)
        .join("g")
        .attr("class", "node-tooltip-group")
        .style("opacity", 0)
        .style("pointer-events", "none");
        
    // Remove background rectangles and only use text for tooltips
    nodeTooltipGroups.append("text")
        .attr("class", "tooltip-text")
        .attr("dy", "0.35em")  // Center text vertically
        .attr("text-anchor", "middle")  // Center text horizontally
        .attr("dominant-baseline", "middle")  // SVG-specific vertical alignment
        .attr("fill", "#FFFFFF")  // White text for contrast
        .attr("font-weight", "600")  // Semi-bold for better readability
        .style("font-size", "12px")
        .text(d => d.id)
        .style("pointer-events", "none")
        .style("text-shadow", "0 1px 3px rgba(0,0,0,0.9), 0 1px 10px rgba(0,0,0,1)");  // Enhanced shadow for better visibility
    
    // Use mouse events on the original nodes to control tooltip visibility
    nodes.on("mouseenter", function(event, d) {
        // Only show tooltips if popup is not visible
        if (document.body.classList.contains("popup-visible")) return;
        
        // Hide any existing tooltips (ensuring only one shows at a time)
        nodeTooltipGroups.style("opacity", 0);
        
        // Find the corresponding tooltip
        const nodeIndex = graphData.nodes.findIndex(n => n.id === d.id);
        if (nodeIndex > -1) {
            const tooltipGroup = nodeTooltipGroups.filter((td, i) => i === nodeIndex);
            
            // Calculate tooltip position
            const nodeSize = sizeScale(surveyData[d.id]?.["Sample Size"] || 0);
            const offset = nodeSize + 10; // Distance from the node edge
            
            // Position the text above the node
            tooltipGroup.select(".tooltip-text")
                .attr("y", -offset);
            
            // Make sure the tooltip layer is in the front by moving it to the end
            tooltipLayer.raise();
                
            // Also make sure this specific tooltip is on top within the layer
            tooltipGroup.raise();
                
            // Show the tooltip with a slight fade-in
            tooltipGroup
                .style("opacity", 0)
                .transition()
                .duration(100)
                .style("opacity", 1);
        }
    })
    .on("mouseleave", function() {
        // Hide tooltips with a slight delay to prevent flickering
        nodeTooltipGroups
            .transition()
            .duration(150)
            .style("opacity", 0);
    });
    
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
        
        // Create a container for the visualization
        const vizContainer = document.createElement("div");
        vizContainer.className = "visualization-container";
        vizContainer.style.width = "100%";
        vizContainer.style.height = "150px";
        vizContainer.style.marginBottom = "20px";
        vizContainer.style.position = "relative";
        
        // Create SVG for the visualization
        const svgElem = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svgElem.setAttribute("width", "100%");
        svgElem.setAttribute("height", "100%");
        vizContainer.appendChild(svgElem);
        
        // Add the visualization container to the popup content
        popupContent.appendChild(vizContainer);
        
        // Find the highest percentage answer
        const sortedOptions = [...options].sort((a, b) => b.Percentage - a.Percentage);
        const highestOptionIndex = options.findIndex(opt => opt.Option === sortedOptions[0].Option);
        
        // Add options with letters and visualization
        options.forEach((option, index) => {
            const letter = String.fromCharCode(97 + index); // 97 is ASCII for 'a'
            
            const optionDiv = document.createElement("div");
            optionDiv.className = "option";
            
            // Update the left border color based on whether this is the highest answer
            if (index === highestOptionIndex) {
                optionDiv.style.borderLeftColor = "#5CFF5C"; // Saturated lime green for highest answer
            } else {
                optionDiv.style.borderLeftColor = "#FFFFFF"; // White for other answers
            }
            
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
        
        // Now create the bar chart visualization
        const barChartSvg = d3.select(svgElem);
        
        // Make sure SVG dimensions are explicitly set
        svgElem.setAttribute("width", "100%");
        svgElem.setAttribute("height", "100%");
        svgElem.style.minHeight = "150px";
        
        // Wait for the SVG to be in the DOM before calculating dimensions
        setTimeout(() => {
            try {
                // Get actual dimensions after rendering
                const svgRect = svgElem.getBoundingClientRect();
                const margin = { top: 20, right: 20, bottom: 30, left: 40 };
                const width = Math.max(svgRect.width - margin.left - margin.right, 100); // Ensure minimum width
                const height = Math.max(svgRect.height - margin.top - margin.bottom, 80); // Ensure minimum height
                
                const g = barChartSvg.append("g")
                    .attr("transform", `translate(${margin.left},${margin.top})`);
                
                // Make sure we have valid options data
                if (!options || !options.length) {
                    console.error("No options data available for visualization");
                    return;
                }
                
                // Set up scales
                const x = d3.scaleBand()
                    .domain(options.map((d, i) => String.fromCharCode(97 + i)))
                    .range([0, width])
                    .padding(0.3);
                
                const y = d3.scaleLinear()
                    .domain([0, d3.max(options, d => d.Percentage) * 1.1]) // 10% padding at top
                    .range([height, 0]);
                
                // Add bars with NEW COLOR LOGIC - saturated lime green for highest, white for others
                g.selectAll(".bar")
                    .data(options)
                    .enter().append("rect")
                    .attr("class", "bar")
                    .attr("x", (d, i) => x(String.fromCharCode(97 + i)))
                    .attr("y", d => y(d.Percentage))
                    .attr("width", x.bandwidth())
                    .attr("height", d => height - y(d.Percentage))
                    .attr("fill", (d, i) => {
                        // Check if this is the highest confidence answer
                        if (i === highestOptionIndex) {
                            // Use saturated lime green for highest answer
                            return "#5CFF5C";
                        } else {
                            // Use white with some transparency for other answers
                            return "rgba(255, 255, 255, 0.8)";
                        }
                    })
                    .attr("rx", 4) // Rounded corners
                    .attr("ry", 4);
                
                // Add labels at top of bars
                g.selectAll(".label")
                    .data(options)
                    .enter().append("text")
                    .attr("class", "label")
                    .attr("x", (d, i) => x(String.fromCharCode(97 + i)) + x.bandwidth() / 2)
                    .attr("y", d => y(d.Percentage) - 5)
                    .attr("text-anchor", "middle")
                    .attr("dominant-baseline", "central")
                    .attr("fill", "#FFFFFF")
                    .style("font-size", "12px")
                    .style("font-weight", "600")
                    .style("text-shadow", "0 1px 2px rgba(0,0,0,0.8)")
                    .text(d => (d.Percentage * 100).toFixed(0) + "%");
                
                // Add x axis (option letters)
                g.append("g")
                    .attr("transform", `translate(0,${height})`)
                    .call(d3.axisBottom(x))
                    .selectAll("text")
                    .attr("fill", "#CCCCCC")
                    .style("font-weight", "600");
                    
                // Remove x-axis line
                g.select(".domain").remove();
                g.selectAll(".tick line").remove();
            } catch (error) {
                console.error("Error creating visualization:", error);
                // Add a fallback text message if visualization fails
                barChartSvg.append("text")
                    .attr("x", "50%")
                    .attr("y", "50%")
                    .attr("text-anchor", "middle")
                    .attr("fill", "#999")
                    .text("Visualization could not be loaded");
            }
        }, 10); // Small delay to ensure DOM is ready
        
        // Display the popup with animations disabled
        popupElement.style.display = "block";
        popupElement.style.animation = "none";
        popupElement.style.transition = "none";
        
        // Force a reflow to ensure styles are applied immediately
        void popupElement.offsetWidth;
        
        // Add class to body to hide all labels when popup is visible
        document.body.classList.add("popup-visible");
        
        // Hide tooltips when popup is active
        nodeTooltipGroups.style("opacity", 0);
        
        // Stop event propagation
        event.stopPropagation();
    });

    // Update the document click handler to also remove selected class
    svg.on("click", function(event) {
        // Only handle clicks directly on the SVG, not on nodes
        if (event.target === this) {
            // Hide popup
            popup.style("display", "none");
            document.body.classList.remove("popup-visible");
            nodes.classed("selected", false);
            
            // Clear search
            searchInput.value = '';
            nodes.classed('highlighted', false)
                .classed('dimmed', false);
            links.classed('dimmed', false);
        }
    });
    
    // Sync positions of tooltips with nodes
    simulation.on("tick", () => {
        // Update link positions
        links
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

        // Update node positions
        nodeGroups
            .attr("transform", d => `translate(${d.x},${d.y})`);
            
        // Update tooltip positions to match nodes
        nodeTooltipGroups
            .attr("transform", (d, i) => {
                const node = graphData.nodes[i];
                if (node && node.x !== undefined && node.y !== undefined) {
                    return `translate(${node.x},${node.y})`;
                }
                return "translate(0,0)";
            });
            
        // Calculate cluster centers
        clusterLabels.forEach(cluster => {
            let centerX = 0;
            let centerY = 0;
            let nodeCount = 0;
            
            cluster.nodes.forEach(nodeId => {
                const node = graphData.nodes.find(n => n.id === nodeId);
                if (node && typeof node.x === 'number' && typeof node.y === 'number') {
                    centerX += node.x;
                    centerY += node.y;
                    nodeCount++;
                }
            });
            
            if (nodeCount > 0) {
                cluster.x = centerX / nodeCount;
                cluster.y = centerY / nodeCount;
            }
        });
        
        // Simple label overlap prevention
        const labelPadding = 40; // Min distance between labels
        let iterations = 5;
        
        while (iterations > 0) {
            let moved = false;
            
            for (let i = 0; i < clusterLabels.length; i++) {
                for (let j = i + 1; j < clusterLabels.length; j++) {
                    const labelA = clusterLabels[i];
                    const labelB = clusterLabels[j];
                    
                    const dx = labelB.x - labelA.x;
                    const dy = labelB.y - labelA.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    
                    if (distance < labelPadding) {
                        // Move labels away from each other
                        const moveX = (dx / distance) * (labelPadding - distance) * 0.5;
                        const moveY = (dy / distance) * (labelPadding - distance) * 0.5;
                        
                        labelA.x -= moveX;
                        labelA.y -= moveY;
                        labelB.x += moveX;
                        labelB.y += moveY;
                        moved = true;
                    }
                }
            }
            
            if (!moved) break;
            iterations--;
        }
        
        // Update label group positions
        g.selectAll(".cluster-label-group")
            .data(clusterLabels)
            .join("g")
            .attr("class", "cluster-label-group")
            .attr("transform", d => `translate(${d.x},${d.y})`);
            
        // Ensure label groups have rect and text
        const labelGroups = g.selectAll(".cluster-label-group");
        
        // Add text if not exists (removed background rect)
        labelGroups.each(function(d) {
            const group = d3.select(this);
            
            if (group.select("text").empty()) {
                group.append("text")
                    .attr("class", "cluster-label")
                    .attr("text-anchor", "middle")
                    .attr("dominant-baseline", "middle") // SVG vertical alignment
                    .attr("dy", "0.3em")
                    .attr("font-size", "16px")
                    .attr("font-weight", "bold")
                    .attr("fill", "#FFFFFF")
                    .attr("opacity", 0.9)
                    .attr("pointer-events", "none")
                    .style("text-shadow", "0 0 8px rgba(0, 0, 0, 0.9), 0 0 15px rgba(0, 0, 0, 0.8)") // Enhanced text shadow
                    .text(d => d.label.toUpperCase());
            }
        });
    });

    // Create cluster label groups initially
    const clusterLabelGroups = g.selectAll(".cluster-label-group")
        .data(clusterLabels)
        .join("g")
        .attr("class", "cluster-label-group");
    
    // Only add text labels without backgrounds
    clusterLabelGroups.append("text")
        .attr("class", "cluster-label")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle") // SVG-specific vertical alignment
        .attr("dy", "0.3em")
        .attr("font-size", "16px")
        .attr("font-weight", "bold")
        .attr("fill", "#FFFFFF")
        .attr("opacity", 1) // Full opacity for better contrast
        .attr("pointer-events", "none")
        .style("text-shadow", "0 0 8px rgba(0, 0, 0, 0.9), 0 0 15px rgba(0, 0, 0, 0.8)") // Enhanced text shadow for better visibility
        .text(d => d.label.toUpperCase());
    
    // Update label background sizes just once after simulation
    simulation.on("end", () => {
        // Final positioning adjustments for tooltips
        nodeTooltipGroups.each(function(d) {
            // No background adjustments needed anymore
        });
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

    // Update the CSS for dimmed nodes and links and ensure proper stacking order
    const style = document.createElement('style');
    style.textContent = `
      .node.dimmed {
        opacity: 0.1 !important; /* 10% opacity for non-highlighted nodes */
      }
      
      .link.dimmed {
        opacity: 0.05 !important; /* Even less visible links */
      }
      
      /* Remove default glow from nodes */
      .node {
        filter: none !important;
      }
      
      /* Add strong yellow glow only for selected nodes */
      .node.selected {
        filter: drop-shadow(0 0 12px #F7D115) !important;
      }
      
      /* Ensure tooltips are always on top */
      .tooltip-layer {
        z-index: 9999 !important;
      }
      
      .node-tooltip-group text {
        z-index: 10000 !important;
        font-family: 'Inter', sans-serif;
        dominant-baseline: middle;
      }
      
      .node-tooltip-group rect {
        z-index: 9999 !important;
      }
    `;
    document.head.appendChild(style);

    // Update CSS styles for cluster labels
    const labelStyle = document.createElement('style');
    labelStyle.textContent = `
        .cluster-label {
            font-family: 'Inter', sans-serif;
            text-anchor: middle;
            dominant-baseline: middle;
            user-select: none;
            letter-spacing: 0.5px;
        }
        
        .cluster-label-bg {
            pointer-events: none;
        }
        
        @media (max-width: 768px) {
            .cluster-label {
                font-size: 14px !important;
            }
        }
    `;
    document.head.appendChild(labelStyle);

    // Make sure tooltip layer is the last child of the SVG (ensures it's rendered last/on top)
    // Remove and reinsert at the end
    tooltipLayer.remove();
    svg.node().appendChild(tooltipLayer.node());

    // Add better styling for tooltips
    const tooltipStyle = document.createElement('style');
    tooltipStyle.textContent = `
        .tooltip-layer {
            pointer-events: none !important;
        }
        
        .node-tooltip-group {
            pointer-events: none !important;
        }
        
        .tooltip-text {
            fill: white;
            font-weight: 600;
            text-shadow: 0 1px 3px rgba(0,0,0,0.9);
        }
    `;
    document.head.appendChild(tooltipStyle);
}); 