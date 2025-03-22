// Load both data files
Promise.all([
    d3.json('src/data/semantic_graph.json'),
    d3.json('src/data/clean_survey_data.json')
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
            g.attr("transform", event.transform);
            tooltipLayer.attr("transform", event.transform);
        });

    svg.call(zoom);
    svg.style("pointer-events", "auto");
    g.style("pointer-events", "auto");

    // Calculate node sizes based on sample size from node data
    const maxSampleSize = Math.max(...graphData.nodes.map(d => d.size));
    const sizeScale = d3.scaleSqrt()
        .domain([0, maxSampleSize])
        .range([5, 30]);

    // UPDATED: New function to calculate node gradient based on answer distribution
    function createNodeGradient(nodeId) {
        if (!surveyData[nodeId] || !surveyData[nodeId].Responses) {
            return `url(#default-gradient)`;
        }
        
        // Get the responses directly from the new structure
        const options = surveyData[nodeId].Responses;
        if (!options || !options.length) {
            return `url(#default-gradient)`;
        }
        
        // Sort options by percentage in descending order
        const sortedOptions = [...options].sort((a, b) => b.Percentage - a.Percentage);
        
        // Define the option colors
        const optionColors = ["#5669FF", "#04B488", "#FCCE00", "#FF5E3B", "#C73A75"];
        
        // Create the gradient
        const gradientId = `gradient-${nodeId.replace(/[^a-zA-Z0-9]/g, '_')}`;
        
        const svg = d3.select("svg");
        let defs = svg.select("defs");
        if (defs.empty()) {
            defs = svg.append("defs");
        }
        
        // Remove existing gradient if any
        defs.select(`#${gradientId}`).remove();
        
        // Create linear gradient element
        // Set direction from top-left to bottom-right
        const gradient = defs.append("linearGradient")
            .attr("id", gradientId)
            .attr("x1", "0%")   // Start from left
            .attr("y1", "0%")   // Start from top
            .attr("x2", "100%") // End at right
            .attr("y2", "100%") // End at bottom
        
        // Calculate the gradient stops based on percentages
        let cumulativePercentage = 0;
        
        sortedOptions.forEach((option, i) => {
            // Get color for this option (loop if we have more options than colors)
            const colorIndex = i % optionColors.length;
            const color = optionColors[colorIndex];
            
            // Add a stop at the current cumulative percentage position
            gradient.append("stop")
                .attr("offset", `${cumulativePercentage}%`)
                .attr("stop-color", color);
            
            // Update cumulative percentage for next color
            cumulativePercentage += option.Percentage;
        });
        
        // Add the final stop to complete the gradient
        gradient.append("stop")
            .attr("offset", "100%")
            .attr("stop-color", optionColors[(sortedOptions.length - 1) % optionColors.length] || optionColors[0]);
        
        // Return the url reference to the gradient
        return `url(#${gradientId})`;
    }

    // Create default gradient
    function createDefaultGradients() {
        const svg = d3.select("svg");
        let defs = svg.select("defs");
        if (defs.empty()) {
            defs = svg.append("defs");
        }
        
        // Create a default gradient for nodes without data
        const defaultGradient = defs.append("linearGradient")
            .attr("id", "default-gradient")
            .attr("x1", "0%")   // Start from left
            .attr("y1", "0%")   // Start from top
            .attr("x2", "100%") // End at right
            .attr("y2", "100%") // End at bottom
            
        defaultGradient.append("stop")
            .attr("offset", "0%")
            .attr("stop-color", "#5669FF");
            
        defaultGradient.append("stop")
            .attr("offset", "25%")
            .attr("stop-color", "#04B488");
            
        defaultGradient.append("stop")
            .attr("offset", "50%")
            .attr("stop-color", "#FCCE00");
            
        defaultGradient.append("stop")
            .attr("offset", "75%")
            .attr("stop-color", "#FF5E3B");
            
        defaultGradient.append("stop")
            .attr("offset", "100%")
            .attr("stop-color", "#C73A75");
    }
    
    // Call this function to create the default gradient
    createDefaultGradients();

    // Set initial positions for all nodes to start exactly at center with very small jitter
    const jitter = 1; // Very small jitter to prevent perfect overlap
    graphData.nodes.forEach(node => {
        node.x = width / 2 + (Math.random() * jitter * 2 - jitter);
        node.y = height / 2 + (Math.random() * jitter * 2 - jitter);
        // Also set fixed positions initially to prevent immediate movement
        node.fx = node.x;
        node.fy = node.y;
    });

    // Create force simulation - MODIFIED FOR INSIDE-OUT EXPANSION
    const simulation = d3.forceSimulation(graphData.nodes)
        .force("link", d3.forceLink(graphData.links)
            .id(d => d.id)
            .strength(d => d.strength * 0.1)) // Reduced link strength to allow better expansion
        .force("charge", d3.forceManyBody()
            .strength(-250)) // Reduced repulsive force to keep nodes closer together
        .force("center", d3.forceCenter(width / 2, height / 2)
            .strength(0.12)) // Increased center attraction to keep nodes within viewport
        .force("collision", d3.forceCollide()
            .radius(d => sizeScale(d.size) + 3) // Slightly reduced collision radius
            .strength(0.9)) // Slightly reduced to allow some overlap for compact layout
        .force("x", d3.forceX(width / 2).strength(0.1)) // Increased X-force to keep nodes centered horizontally
        .force("y", d3.forceY(height / 2).strength(0.1)) // Increased Y-force to keep nodes centered vertically
        .alpha(1) // Start with maximum energy
        .alphaDecay(0.01) // Slower decay for smoother expansion
        .stop(); // Initially stop the simulation
    
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
    
    // IMPROVED: Assign cluster names based on common themes 
    // with better filtering to exclude common question words
    communities.forEach((community, index) => {
        // The community detection algorithm still runs to organize the graph visually
        // But we no longer need to create or store cluster labels
    });
    
    // Let the DOM render the initial centered nodes first
    setTimeout(() => {
        // Release the fixed positions after a short delay
        graphData.nodes.forEach(node => {
            node.fx = null;
            node.fy = null;
        });
        // Start the simulation
        simulation.restart();
        
        // After simulation runs for a few seconds, fit graph to viewport
        setTimeout(fitGraphToViewport, 500);
    }, 500); // 500ms delay to ensure visible starting state

    // Function to fit the entire graph within the viewport
    function fitGraphToViewport() {
        // Get current bounds of the graph
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        
        graphData.nodes.forEach(node => {
            if (node.x < minX) minX = node.x;
            if (node.x > maxX) maxX = node.x;
            if (node.y < minY) minY = node.y;
            if (node.y > maxY) maxY = node.y;
        });
        
        // Add padding
        const padding = 50;
        minX -= padding;
        maxX += padding;
        minY -= padding;
        maxY += padding;
        
        // Calculate the scale and translate parameters to fit the graph
        const graphWidth = maxX - minX;
        const graphHeight = maxY - minY;
        
        const scaleX = width / graphWidth;
        const scaleY = height / graphHeight;
        
        // Use the smaller scale to ensure everything fits
        const scale = Math.min(scaleX, scaleY, 1.0); // Cap at 1.0 to prevent excessive scaling
        
        // Calculate center point of the graph
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        
        // Calculate translation to center the graph
        const translateX = width / 2 - scale * centerX;
        const translateY = height / 2 - scale * centerY;
        
        // Apply the transform using D3 zoom
        svg.transition()
           .duration(750)
           .call(zoom.transform, d3.zoomIdentity
               .translate(translateX, translateY)
               .scale(scale));
    }

    // Filter links by strength threshold
    const strengthThreshold = 0.2; // Adjust this value
    const filteredLinks = graphData.links.filter(link => link.strength >= strengthThreshold);
    
    // Create the links
    const links = g.append("g")
        .selectAll("line")
        .data(filteredLinks)
        .join("line")
        .attr("class", "link")
        .style("stroke-width", d => Math.sqrt(d.strength) * 2);

    // Create node groups
    const nodeGroups = g.append("g")
        .selectAll("g")
        .data(graphData.nodes)
        .join("g")
        .attr("class", "node-group")
        .call(drag(simulation));

    // Add circles to node groups with SIMPLIFIED event handlers
    const nodes = nodeGroups
        .append("circle")
        .attr("class", "node")
        .attr("r", d => {
            const radius = sizeScale(d.size);
            return radius;
        })
        .style("fill", d => {
            // Use gradient coloring based on option percentages instead of confidence
            const gradientUrl = createNodeGradient(d.id);
            return gradientUrl;
        })
        .style("stroke", "none")
        .style("cursor", "pointer"); // Make sure cursor indicates clickable
    
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
        .attr("dy", "0.35em")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("fill", "#FFFFFF")
        .attr("font-weight", "600")
        .style("font-size", "12px")
        .text(d => d.topic)
        .style("pointer-events", "none")
        .style("text-shadow", "0 1px 3px rgba(0,0,0,0.9), 0 1px 10px rgba(0,0,0,1)");
    
    // UPDATED: Handle popup - modified to work with new data structure
    // Initialize popup element directly 
    let popupElement = document.getElementById("popup");
    if (!popupElement) {
        popupElement = document.createElement("div");
        popupElement.id = "popup";
        popupElement.className = "popup";
        document.body.appendChild(popupElement);
    }
    
    // COMBINED EVENT HANDLERS - Clean implementation for all node interactions
    nodeGroups.on("mouseenter", function(event, d) {
        // Only prevent tooltips for non-highlighted nodes when popup is visible
        // Allow tooltips for connected (highlighted) nodes even when popup is visible
        const isPopupVisible = document.body.classList.contains("popup-visible");
        const node = d3.select(this).select("circle");
        const isHighlighted = node.classed("highlighted");
        
        // Show tooltips for nodes that are either: 
        // 1. When no popup is visible, OR
        // 2. When popup is visible but this is a highlighted (connected) node
        if (isPopupVisible && !isHighlighted) return;
        
        const nodeIndex = graphData.nodes.findIndex(n => n.id === d.id);
        if (nodeIndex > -1) {
            const tooltipGroup = nodeTooltipGroups.filter((td, i) => i === nodeIndex);
            const nodeSize = sizeScale(d.size);
            const offset = nodeSize + 10;
            
            tooltipGroup.select(".tooltip-text").attr("y", -offset);
            tooltipLayer.raise();
            tooltipGroup.raise();
            
            tooltipGroup
                .style("opacity", 0)
                .transition()
                .duration(100)
                .style("opacity", 1);
                
            // Add hover effect to any node being hovered over
            node.style("filter", "drop-shadow(0 0 10px rgba(255,255,255,0.7))");
        }
    })
    .on("mouseleave", function() {
        nodeTooltipGroups
            .transition()
            .duration(150)
            .style("opacity", 0);
            
        // Reset filter for the hovered node
        const node = d3.select(this).select("circle");
        node.style("filter", null);
    })
    .on("click", function(event, d) {
        event.stopPropagation();
        
        // Find the question data directly from the surveyData
        const questionData = surveyData[d.id];
        if (!questionData) {
            return;
        }
        
        // Reset states
        if (document.getElementById('search-input')) {
        document.getElementById('search-input').value = '';
        }
        
        // Reset any previous node styles - including selected state and strokes
        nodes.classed('highlighted', false)
             .classed('dimmed', false)
             .classed("selected", false)
             .style("stroke", "none")
             .style("stroke-width", null)
             .style("fill", node => {
                // Restore original gradient fill for all nodes
                const gradientUrl = createNodeGradient(node.id);
                return gradientUrl;
             });
             
        links.classed('dimmed', false)
             .classed('highlighted', false);
        
        // Highlight clicked node
        d3.select(this).select("circle")
            .classed("selected", true)
            .style("stroke", "#FFFFFF")  // Add white stroke
            .style("stroke-width", "4px"); // With 4px width
        
        // Find and highlight connected nodes
        const connectedNodeIds = new Set();
        links.each(function(link) {
            if (link.source.id === d.id) {
                connectedNodeIds.add(link.target.id);
            } else if (link.target.id === d.id) {
                connectedNodeIds.add(link.source.id);
            }
        });
        
        // Apply highlighting to connected nodes
        nodes.classed('highlighted', function(n) {
            return connectedNodeIds.has(n.id);
        });
        
        // Dim nodes that are not selected or connected
        nodes.classed('dimmed', function(n) {
            return n.id !== d.id && !connectedNodeIds.has(n.id);
        });
        
        // Highlight links connected to the selected node, dim others
        links.classed('highlighted', function(link) {
            return link.source.id === d.id || link.target.id === d.id;
        }).classed('dimmed', function(link) {
            return link.source.id !== d.id && link.target.id !== d.id;
        });
        
        // Get response data
        const responsesData = questionData.Responses;
        if (!responsesData) {
            return;
        }
        
        // Create popup content
        popupElement.innerHTML = ""; // Clear existing content
        
        // Create the base structure
        const popupContent = document.createElement("div");
        popupContent.className = "popup-content";
        
        // Add question
        const question = document.createElement("div");
        question.className = "question";
        question.textContent = d.id;
        popupContent.appendChild(question);
        
        // Create visualization container
        const vizContainer = document.createElement("div");
        vizContainer.className = "visualization-container";
        vizContainer.style.width = "100%";
        vizContainer.style.height = "150px";
        vizContainer.style.marginBottom = "20px";
        vizContainer.style.position = "relative";
        
        // Create SVG element
        const svgElem = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svgElem.setAttribute("width", "100%");
        svgElem.setAttribute("height", "100%");
        vizContainer.appendChild(svgElem);
        popupContent.appendChild(vizContainer);
        
        // Create options container
        const optionsContainer = document.createElement("div");
        optionsContainer.className = "options-container";
        
        // Add options
        const optionColors = ["#5669FF", "#04B488", "#FCCE00", "#FF5E3B", "#C73A75"];
        responsesData.forEach((option, index) => {
            const letter = String.fromCharCode(97 + index);
            
            const optionDiv = document.createElement("div");
            optionDiv.className = "option";
            
            const colorIndex = index % optionColors.length;
            optionDiv.style.borderLeftColor = optionColors[colorIndex];
            
            const optionText = document.createElement("div");
            optionText.className = "option-text";
            
            const letterSpan = document.createElement("span");
            letterSpan.className = "option-letter";
            letterSpan.textContent = letter + ".";
            optionText.appendChild(letterSpan);
            
            optionText.appendChild(document.createTextNode(" " + option.Option));
            
            const optionPercent = document.createElement("div");
            optionPercent.className = "option-percent";
            optionPercent.textContent = (option.Percentage).toFixed(1) + "%";
            
            optionDiv.appendChild(optionText);
            optionDiv.appendChild(optionPercent);
            optionsContainer.appendChild(optionDiv);
        });
        
        popupContent.appendChild(optionsContainer);
        popupElement.appendChild(popupContent);
        
        // Add footer with info
        const footer = document.createElement("div");
        footer.className = "popup-footer";
        
        const surveyName = document.createElement("p");
        surveyName.textContent = questionData["Survey Name"] || d.survey_name;
        
        const sampleSize = document.createElement("p");
        sampleSize.textContent = questionData["Sample Size"] + " responses";
        
        footer.appendChild(surveyName);
        footer.appendChild(sampleSize);
        popupElement.appendChild(footer);
        
        // Add close button
        const closeBtn = document.createElement("div");
        closeBtn.className = "close-btn";
        closeBtn.textContent = "×";
        closeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            popupElement.style.display = "none";
            popupElement.classList.remove("visible");
            document.body.classList.remove("popup-visible");
            
            // Reset selected node styles
            nodes.filter(".selected")
                 .classed("selected", false)
                 .style("stroke", "none")
                 .style("stroke-width", null);
        });
        
        popupElement.appendChild(closeBtn);
        
        // Now create the bar chart visualization
        const barChartSvg = d3.select(svgElem);
        
        // Make SVG dimensions explicit
        svgElem.setAttribute("width", "100%");
        svgElem.setAttribute("height", "100%");
        svgElem.style.minHeight = "150px";
        
        // IMPORTANT: Show the popup FIRST before creating the visualization
        // UPDATED: Set display style explicitly with !important
        popupElement.style.cssText = "display: block !important;";
        popupElement.classList.add("visible");
        document.body.classList.add("popup-visible");
        
        // Create the chart after popup is visible
        setTimeout(() => {
            try {
                const svgRect = svgElem.getBoundingClientRect();
                const margin = { top: 20, right: 20, bottom: 30, left: 40 };
                const width = Math.max(svgRect.width - margin.left - margin.right, 100);
                const height = Math.max(svgRect.height - margin.top - margin.bottom, 80);
                
                const g = barChartSvg.append("g")
                    .attr("transform", `translate(${margin.left},${margin.top})`);
                
                if (!responsesData || !responsesData.length) {
                    return;
                }
                
                // Set up scales
                const x = d3.scaleBand()
                    .domain(responsesData.map((d, i) => String.fromCharCode(97 + i)))
                    .range([0, width])
                    .padding(0.3);
                
                const y = d3.scaleLinear()
                    .domain([0, d3.max(responsesData, d => d.Percentage) * 1.1])
                    .range([height, 0]);
                
                // Add bars with colors
                g.selectAll(".bar")
                    .data(responsesData)
                    .enter().append("rect")
                    .attr("class", "bar")
                    .attr("x", (d, i) => x(String.fromCharCode(97 + i)))
                    .attr("y", d => y(d.Percentage))
                    .attr("width", x.bandwidth())
                    .attr("height", d => height - y(d.Percentage))
                    .attr("fill", (d, i) => {
                        const colorIndex = i % optionColors.length;
                        return optionColors[colorIndex];
                    })
                    .attr("rx", 4)
                    .attr("ry", 4);
                
                // Add labels at top of bars
                g.selectAll(".label")
                    .data(responsesData)
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
                    .text(d => (d.Percentage).toFixed(0) + "%");
                
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
                barChartSvg.append("text")
                    .attr("x", "50%")
                    .attr("y", "50%")
                    .attr("text-anchor", "middle")
                    .attr("fill", "#999")
                    .text("Visualization could not be loaded");
            }
        }, 50); // Longer delay to ensure DOM is ready
    });

    // Now let's update the SVG click handler to properly close the popup
    svg.on("click", function(event) {
        // Only handle clicks directly on the SVG, not on nodes
        if (event.target === this) {
            closePopup();
        }
    });
    
    // Dedicated function to close the popup (reusable)
    function closePopup() {
        // Get the popup element
        const popupElement = document.getElementById("popup");
        
        // Check if popup exists
        if (popupElement) {
            // Hide the popup
            popupElement.style.cssText = "display: none !important;";
            popupElement.classList.remove("visible");
        }
        
        // Remove class from body
        document.body.classList.remove("popup-visible");
        
        // Fully reset all node styles, including filter
        nodes.classed("selected", false)
             .classed('highlighted', false)
             .classed('dimmed', false)
             .style("fill", d => {
                // Restore original gradient fill
                const gradientUrl = createNodeGradient(d.id);
                return gradientUrl;
             })
             .style("filter", null) // Completely remove filter
             .style("stroke", "none") // Reset stroke
             .style("stroke-width", null); // Reset stroke width
        
        // Reset link highlighting
        links.classed('highlighted', false)
             .classed('dimmed', false);
        
        // Clear search
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.value = '';
        }
    }
    
    // Update the simulation tick function
    simulation.on("tick", () => {
        links
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

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
            
        // Ensure tooltips stay visible for highlighted nodes if popup is visible
        if (document.body.classList.contains("popup-visible")) {
            nodes.each(function(d) {
                const node = d3.select(this);
                if (node.classed("highlighted")) {
                    const nodeIndex = graphData.nodes.findIndex(n => n.id === d.id);
                    if (nodeIndex > -1) {
                        nodeTooltipGroups
                            .filter((td, i) => i === nodeIndex)
                            .raise();
                    }
                }
            });
        }
    });

    // Define the drag behavior
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

    // Fix the search functionality to ensure only exact matches are highlighted
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', function() {
        const searchTerm = this.value.toLowerCase().trim();
        
        if (searchTerm === '') {
            // Reset all nodes and links except selected ones
            nodes.each(function(d) {
                const node = d3.select(this);
                
                if (!node.classed("selected")) {
                    // Only reset unselected nodes
                    node.classed('highlighted', false)
                        .classed('dimmed', false)
                        .style("fill", d => createNodeGradient(d.id))
                        .style("filter", null); // Clear filter property
                }
            });
            
            links.classed('dimmed', false)
                 .classed('highlighted', false);
            return;
        }
        
        // Check each node for match
        const matchingNodes = [];
        nodes.each(function(d) {
            const node = d3.select(this);
            
            // Skip modifying selected nodes
            if (node.classed("selected")) {
                return;
            }
            
            // Check for match in question text (id)
            let isMatch = d.id.toLowerCase().includes(searchTerm);
            
            // Check for match in topic
            if (!isMatch && d.topic) {
                isMatch = d.topic.toLowerCase().includes(searchTerm);
            }
            
            // Check for match in options
            if (!isMatch && d.options) {
                isMatch = d.options.toLowerCase().includes(searchTerm);
            }
            
            // Apply classes based on match
            node.classed('highlighted', isMatch)
                .classed('dimmed', !isMatch);
            
            // Apply appropriate filter
            if (isMatch) {
                node.style("filter", "drop-shadow(0 0 8px rgba(255,255,255,0.6))");
                matchingNodes.push(d.id);
            } else {
                node.style("filter", null);
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
        opacity: 0.15 !important; /* 15% opacity for non-highlighted nodes */
        transform: scale(0.95);
      }
      
      .link.dimmed {
        opacity: 0.05 !important; /* Even less visible links */
      }
      
      /* Base node styling - removed filter to allow inline styles to take precedence */
      .node {
        transition: all 0.2s ease-out;
      }
      
      /* Selected nodes styling */
      .node.selected {
        transform: scale(1.15);
        /* Keep original fill, add white stroke in JS */
      }
      
      /* Highlighted nodes */
      .node.highlighted {
        transform: scale(1.08);
        /* Filter handled with inline styles */
      }
      
      /* Node hover effects - only applied on actual hover via JS */
      
      /* Highlighted links */
      .link.highlighted {
        stroke: #83A2FF !important;
        stroke-opacity: 0.8 !important;
        stroke-width: 2px !important;
      }
      
      /* Ensure tooltips are always on top */
      .tooltip-layer {
        z-index: 10000 !important;
        pointer-events: none !important;
      }
      
      .node-tooltip-group {
        z-index: 10001 !important;
        pointer-events: none !important;
      }
      
      .node-tooltip-group text {
        z-index: 10002 !important;
        font-family: 'Inter', sans-serif;
        dominant-baseline: middle;
        text-shadow: 0 0 8px rgba(0,0,0,1), 0 0 5px rgba(0,0,0,1), 0 1px 3px rgba(0,0,0,1);
      }
      
      /* Make sure tooltips still show even with popup visible */
      body.popup-visible .node-tooltip-group {
        z-index: 10001 !important;
        display: block !important;
      }
    `;
    document.head.appendChild(style);

    // Update CSS styles for popup only
    const popupStyle = document.createElement('style');
    popupStyle.textContent = `
        /* Fix for popup visibility */
        .popup {
            display: none;
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 480px;
            min-height: 292px;
            background: rgba(31, 31, 31, 0.97) !important;
            border-radius: 24px;
            padding: 32px;
            pointer-events: auto;
            color: #eee;
            z-index: 9999;
            box-sizing: border-box;
            border: 1px solid #2c2c2c;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        }
        
        .popup.visible {
            display: block !important;
        }
    `;
    document.head.appendChild(popupStyle);

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
        
        /* Legend styles */
        .color-legend {
            position: fixed;
            bottom: 20px;
            left: 20px;
            background: rgba(20, 20, 20, 0.8);
            border-radius: 12px;
            padding: 8px 12px;
            color: white;
            font-family: 'Inter', sans-serif;
            z-index: 1000;
            pointer-events: none;
            border: 1px solid rgba(255, 255, 255, 0.2);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
            width: 240px; /* Increased width for flex layout */
        }
        
        .legend-title {
            font-size: 12px;
            font-weight: bold;
            margin-bottom: 5px;
            text-align: left; /* Align to left instead of center */
        }
        
        .color-samples-container {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            margin-top: 0;
        }
        
        .color-sample {
            display: flex;
            align-items: center;
            margin-bottom: 4px;
            font-size: 9px;
            width: 110px; /* Fixed width to create two columns */
        }
        
        .color-dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            margin-right: 8px;
            flex-shrink: 0;
        }
        
        .gradient-sample {
            width: 100%;
            height: 8px;
            margin: 8px 0;
            border-radius: 4px;
            background: linear-gradient(to bottom right, #5669FF, #04B488, #FCCE00, #FF5E3B, #C73A75);
        }
        
        .node.selected {
            stroke: #FFFFFF;
            stroke-width: 2px;
        }
    `;
    document.head.appendChild(tooltipStyle);
    
    // Create and add the color legend
    const legendContainer = document.createElement('div');
    legendContainer.className = 'color-legend';
    
    const legendTitle = document.createElement('div');
    legendTitle.className = 'legend-title';
    legendTitle.textContent = 'Answer Colors';
    legendContainer.appendChild(legendTitle);
    
    // Create a container for the color samples with flex layout
    const colorSamplesContainer = document.createElement('div');
    colorSamplesContainer.className = 'color-samples-container';
    legendContainer.appendChild(colorSamplesContainer);
    
    // Define the colors
    const colorLabels = [
        { color: "#5669FF", label: "Option A" },
        { color: "#04B488", label: "Option B" },
        { color: "#FCCE00", label: "Option C" },
        { color: "#FF5E3B", label: "Option D" },
        { color: "#C73A75", label: "Option E" }
    ];
    
    // Add color samples to the flex container
    colorLabels.forEach(item => {
        const colorSample = document.createElement('div');
        colorSample.className = 'color-sample';
        
        const colorDot = document.createElement('div');
        colorDot.className = 'color-dot';
        colorDot.style.backgroundColor = item.color;
        
        const label = document.createElement('span');
        label.textContent = item.label;
        
        colorSample.appendChild(colorDot);
        colorSample.appendChild(label);
        colorSamplesContainer.appendChild(colorSample);
    });
    
    document.body.appendChild(legendContainer);
}); 