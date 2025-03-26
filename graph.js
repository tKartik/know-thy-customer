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
        
        // Define the option colors - ADDED COLORS FOR F AND G
        const optionColors = ["#5669FF", "#04B488", "#FCCE00", "#FF5E3B", "#C73A75", "#8A2BE2", "#00CED1"];
        
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
            .attr("offset", "17%")
            .attr("stop-color", "#04B488");
            
        defaultGradient.append("stop")
            .attr("offset", "34%")
            .attr("stop-color", "#FCCE00");
            
        defaultGradient.append("stop")
            .attr("offset", "51%")
            .attr("stop-color", "#FF5E3B");
            
        defaultGradient.append("stop")
            .attr("offset", "68%")
            .attr("stop-color", "#C73A75");
            
        defaultGradient.append("stop")
            .attr("offset", "84%")
            .attr("stop-color", "#8A2BE2");
            
        defaultGradient.append("stop")
            .attr("offset", "100%")
            .attr("stop-color", "#00CED1");
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
        const node = d3.select(this).select("circle");
        const isSelected = node.classed("selected");
        
        // If popup is visible (any node selected), only show tooltip for connected nodes
        const popupVisible = document.body.classList.contains("popup-visible");
        if (popupVisible) {
            // Only highlight connected nodes when popup is visible
            const isHighlighted = node.classed("highlighted");
            // Skip visual effects for non-highlighted nodes when in selected mode
            if (!isHighlighted && !isSelected) return;
            
            // For highlighted/connected nodes, only apply subtle hover effect
            if (!isSelected) {
                node.style("filter", "drop-shadow(0 0 5px rgba(255,255,255,0.5))");
            }
            
            // Only show tooltips for highlighted/connected nodes
            const nodeIndex = graphData.nodes.findIndex(n => n.id === d.id);
            if (nodeIndex > -1 && (isHighlighted || isSelected)) {
                const tooltipGroup = nodeTooltipGroups.filter((td, i) => i === nodeIndex);
                const nodeSize = sizeScale(d.size);
                const offset = nodeSize + 10;
                
                tooltipGroup.select(".tooltip-text").attr("y", -offset);
                
                // Don't raise/reposition - avoid DOM thrashing
                tooltipGroup
                    .style("opacity", 1)
                    .style("pointer-events", "none");
            }
            return;
        }
        
        // Regular hover behavior for when no node is selected
        if (isSelected) return;
        
        // Standard hover effect 
        node.style("filter", "drop-shadow(0 0 10px rgba(255,255,255,0.7))");
        
        // Show tooltip for this node
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
        }
    })
    .on("mouseleave", function() {
        // Reset hover effect for all non-selected nodes
        const node = d3.select(this).select("circle");
        if (!node.classed("selected")) {
            node.style("filter", null);
        }
        
        // In selected mode, do more efficient tooltip hiding
        if (document.body.classList.contains("popup-visible")) {
            // Don't use transitions in selected mode - immediate hide
            const nodeId = d3.select(this).datum().id;
            const nodeIndex = graphData.nodes.findIndex(n => n.id === nodeId);
            if (nodeIndex > -1) {
                nodeTooltipGroups
                    .filter((td, i) => i === nodeIndex)
                    .style("opacity", 0);
            }
            return;
        }
        
        // Regular transition for normal mode
        nodeTooltipGroups
            .transition()
            .duration(150)
            .style("opacity", 0);
    })
    .on("click", function(event, d) {
        event.stopPropagation();
        
        // Find the question data directly from the surveyData
        const questionData = surveyData[d.id];
        if (!questionData) {
            return;
        }
        
        // Get response data early to avoid unnecessary work if not available
        const responsesData = questionData.Responses;
        if (!responsesData || !responsesData.length) {
            return;
        }
        
        // Reset states
        if (document.getElementById('search-input')) {
            document.getElementById('search-input').value = '';
        }
        
        // Create all DOM elements and build content BEFORE any visual changes
        // This avoids multiple reflows/repaints
        
        // Clear existing content
        popupElement.innerHTML = "";
        
        // Create popup structure first - build everything before adding to DOM
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
        vizContainer.style.cssText = "width:100%;height:150px;margin-bottom:20px;position:relative;";
        
        // Create SVG element
        const svgElem = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svgElem.setAttribute("width", "100%");
        svgElem.setAttribute("height", "100%");
        svgElem.style.minHeight = "150px";
        vizContainer.appendChild(svgElem);
        popupContent.appendChild(vizContainer);
        
        // Create options container
        const optionsContainer = document.createElement("div");
        optionsContainer.className = "options-container";
        
        // Add options
        const optionColors = ["#5669FF", "#04B488", "#FCCE00", "#FF5E3B", "#C73A75", "#8A2BE2", "#00CED1"];
        const optionsFragment = document.createDocumentFragment(); // Use fragment for better performance
        
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
            optionsFragment.appendChild(optionDiv);
        });
        
        optionsContainer.appendChild(optionsFragment);
        popupContent.appendChild(optionsContainer);
        
        // Add footer with info
        const footer = document.createElement("div");
        footer.className = "popup-footer";
        
        const surveyName = document.createElement("p");
        surveyName.textContent = questionData["Survey Name"] || d.survey_name;
        
        const sampleSize = document.createElement("p");
        sampleSize.textContent = questionData["Sample Size"] + " responses";
        
        footer.appendChild(surveyName);
        footer.appendChild(sampleSize);
        
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
                 
            // Remove class from body
            document.body.classList.remove('node-selected');
        });
        
        // Add all elements to popup at once to minimize DOM operations
        popupElement.appendChild(popupContent);
        popupElement.appendChild(footer);
        popupElement.appendChild(closeBtn);
        
        // Now that all DOM elements are constructed, apply node highlighting
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
        
        // Add class to body to dim cluster labels
        document.body.classList.add('node-selected');
        
        // Now create the bar chart visualization - reference D3 selection
        const barChartSvg = d3.select(svgElem);
        
        // Show the popup all at once
        popupElement.style.cssText = "display: block !important;";
        popupElement.classList.add("visible");
        document.body.classList.add("popup-visible");
        
        // Create the chart with requestAnimationFrame for better performance
        requestAnimationFrame(() => {
            try {
                const svgRect = svgElem.getBoundingClientRect();
                const margin = { top: 20, right: 20, bottom: 30, left: 40 };
                const width = Math.max(svgRect.width - margin.left - margin.right, 100);
                const height = Math.max(svgRect.height - margin.top - margin.bottom, 80);
                
                // Create scales outside of DOM manipulation
                const x = d3.scaleBand()
                    .domain(responsesData.map((d, i) => String.fromCharCode(97 + i)))
                    .range([0, width])
                    .padding(0.3);
                
                const y = d3.scaleLinear()
                    .domain([0, d3.max(responsesData, d => d.Percentage) * 1.1])
                    .range([height, 0]);
                
                // Prepare all data at once
                const barData = responsesData.map((d, i) => ({
                    option: d,
                    letter: String.fromCharCode(97 + i),
                    color: optionColors[i % optionColors.length],
                    x: x(String.fromCharCode(97 + i)),
                    y: y(d.Percentage),
                    width: x.bandwidth(),
                    height: height - y(d.Percentage)
                }));
                
                // Create group for chart elements
                const g = barChartSvg.append("g")
                    .attr("transform", `translate(${margin.left},${margin.top})`);
                
                // Add all bars at once
                g.selectAll(".bar")
                    .data(barData)
                    .enter().append("rect")
                    .attr("class", "bar")
                    .attr("x", d => d.x)
                    .attr("y", d => d.y)
                    .attr("width", d => d.width)
                    .attr("height", d => d.height)
                    .attr("fill", d => d.color)
                    .attr("rx", 4)
                    .attr("ry", 4);
                
                // Add all labels at once
                g.selectAll(".label")
                    .data(barData)
                    .enter().append("text")
                    .attr("class", "label")
                    .attr("x", d => d.x + d.width / 2)
                    .attr("y", d => d.y - 5)
                    .attr("text-anchor", "middle")
                    .attr("dominant-baseline", "central")
                    .attr("fill", "#FFFFFF")
                    .style("font-size", "12px")
                    .style("font-weight", "600")
                    .style("text-shadow", "0 1px 2px rgba(0,0,0,0.8)")
                    .text(d => Math.round(d.option.Percentage) + "%");
                
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
                console.error("Error creating chart:", error);
                barChartSvg.append("text")
                    .attr("x", "50%")
                    .attr("y", "50%")
                    .attr("text-anchor", "middle")
                    .attr("fill", "#999")
                    .text("Visualization could not be loaded");
            }
        });
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
        
        // Remove class from body
        document.body.classList.remove('node-selected');
        
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
            
        // Only update cluster labels if popup isn't visible
        if (!document.body.classList.contains("popup-visible")) {
            // Check if we have pre-computed clusters in the data first
            if (graphData.clusters && graphData.clusters.length > 0) {
                createClusterLabels(null); // Pass null to signal using pre-computed clusters
            } else {
                // Fall back to detecting clusters on the fly
                const clusters = detectClusters();
                createClusterLabels(clusters);
            }
        }
            
        // DO NOT reposition tooltips on every tick when popup is visible
        // This was causing continuous reflows and glitching
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
            
            // REMOVED: No glow effect for search matches
            if (isMatch) {
                matchingNodes.push(d.id);
            }
        });
        
        // Dim all links equally - don't highlight connections between matching nodes
        links.classed('dimmed', true)
             .classed('highlighted', false);
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
      
      /* Style for cluster labels */
      .cluster-label text {
        transition: opacity 0.3s ease;
      }
      
      /* When a node is selected, dim all cluster labels */
      body.node-selected .cluster-label text {
        opacity: 0.2 !important;
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

    // Add improved tooltip CSS to reduce glitching
    const tooltipStyle = document.createElement('style');
    tooltipStyle.textContent = `
        .tooltip-layer {
            pointer-events: none !important;
            will-change: transform; /* Optimize for animation */
        }
        
        .node-tooltip-group {
            pointer-events: none !important;
            will-change: transform, opacity; /* Optimize for animation */
            transition: opacity 0.15s ease-out; /* Smooth opacity transition */
        }
        
        .tooltip-text {
            fill: white;
            font-weight: 600;
            text-shadow: 0 1px 3px rgba(0,0,0,0.9);
            paint-order: stroke; /* Improves text rendering */
        }
        
        /* Performance optimization for selected state */
        body.popup-visible .node {
            will-change: transform; /* Optimize transform operations */
            transition: transform 0.2s ease-out, opacity 0.2s ease-out;
        }
        
        /* Reduce animation complexity when popup is visible */
        body.popup-visible .node-tooltip-group {
            transition: none; /* Disable transitions for better performance */
        }
        
        /* Legend styles - COMMENTED OUT
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
        */
        
        .node.selected {
            stroke: #FFFFFF;
            stroke-width: 2px;
        }
    `;
    document.head.appendChild(tooltipStyle);
    
    // Create and add the color legend
    /*
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
        { color: "#C73A75", label: "Option E" },
        { color: "#8A2BE2", label: "Option F" },
        { color: "#00CED1", label: "Option G" }
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
    */

    // Add cluster detection and labeling
    function detectClusters() {
        // Create a map to store node communities
        const communities = new Map();
        
        // Initialize each node in its own community
        graphData.nodes.forEach(node => {
            communities.set(node.id, node.id);
        });
        
        // Simple community detection based on link strength
        let changed = true;
        const linkStrengthThreshold = 0.4; // Increased from 0.4 for tighter, more coherent clusters
        
        while (changed) {
            changed = false;
            // Sort links by strength to prioritize stronger connections first
            const sortedLinks = [...graphData.links].sort((a, b) => b.strength - a.strength);
            
            for (const link of sortedLinks) {
                if (link.strength >= linkStrengthThreshold) {
                    const sourceCommunity = communities.get(link.source.id);
                    const targetCommunity = communities.get(link.target.id);
                    
                    if (sourceCommunity !== targetCommunity) {
                        // Check if merging would create too large a cluster
                        const sourceSize = Array.from(communities.values()).filter(v => v === sourceCommunity).length;
                        const targetSize = Array.from(communities.values()).filter(v => v === targetCommunity).length;
                        
                        // Only merge if the resulting cluster won't be too large
                        if (sourceSize + targetSize <= 20) { // Reduced from 8 to create smaller, more focused clusters
                            // Check semantic coherence before merging
                            const sourceNodes = graphData.nodes.filter(n => communities.get(n.id) === sourceCommunity);
                            const targetNodes = graphData.nodes.filter(n => communities.get(n.id) === targetCommunity);
                            
                            // Only merge if enough strong connections exist between communities
                            const interCommunityLinks = graphData.links.filter(l => 
                                (communities.get(l.source.id) === sourceCommunity && communities.get(l.target.id) === targetCommunity) ||
                                (communities.get(l.source.id) === targetCommunity && communities.get(l.target.id) === sourceCommunity)
                            );
                            
                            // Require multiple strong connections for larger clusters
                            const requiredLinks = Math.max(1, Math.min(sourceSize, targetSize) / 3);
                            const strongEnoughLinks = interCommunityLinks.filter(l => l.strength >= linkStrengthThreshold).length >= requiredLinks;
                            
                            if (strongEnoughLinks) {
                                // Merge communities (smaller into larger for stability)
                                const [fromCommunity, toCommunity] = 
                                    sourceSize < targetSize 
                                        ? [sourceCommunity, targetCommunity] 
                                        : [targetCommunity, sourceCommunity];
                                
                                graphData.nodes.forEach(node => {
                                    if (communities.get(node.id) === fromCommunity) {
                                        communities.set(node.id, toCommunity);
                                    }
                                });
                                changed = true;
                            }
                        }
                    }
                }
            }
        }
        
        // Group nodes by community
        const clusters = new Map();
        communities.forEach((communityId, nodeId) => {
            if (!clusters.has(communityId)) {
                clusters.set(communityId, []);
            }
            clusters.get(communityId).push(nodeId);
        });
        
        return clusters;
    }

    // Function to get cluster label from pre-computed topics in the cluster
    function getClusterKeywords(nodeIds) {
        if (nodeIds.length < 3) return null;
        
        // Get all nodes in the cluster
        const nodes = nodeIds.map(nodeId => 
            graphData.nodes.find(n => n.id === nodeId)
        ).filter(node => node); // Remove null/undefined values
        
        // Extract all question texts to detect domain-specific terms
        const questionTexts = nodes.map(node => node.id || '').filter(text => text);
        
        // Domain-specific keyword dictionaries to improve labeling accuracy
        const domainDictionaries = {
            'Banking & Payments': [
                'bank', 'account', 'payment', 'upi', 'transaction', 'transfer', 'credit', 
                'debit', 'card', 'loan', 'deposit', 'withdraw', 'balance', 'interest', 
                'savings', 'checking', 'mortgage', 'atm', 'branch', 'digital', 'online', 
                'mobile', 'banking', 'fintech', 'pay', 'wallet'
            ],
            'Health & Vaccine': [
                'vaccine', 'vaccination', 'health', 'covid', 'pandemic', 'dose', 'booster',
                'medical', 'hospital', 'doctor', 'clinic', 'medicine', 'treatment',
                'disease', 'illness', 'symptom', 'healthcare', 'immunization'
            ],
            'Investment & Finance': [
                'invest', 'stock', 'market', 'mutual', 'fund', 'portfolio', 'asset',
                'equity', 'trading', 'trader', 'return', 'risk', 'financial', 'wealth',
                'planning', 'retirement', 'capital', 'dividend', 'bond', 'security'
            ],
            'Technology & Digital': [
                'tech', 'digital', 'online', 'internet', 'mobile', 'smartphone', 'app',
                'website', 'software', 'hardware', 'device', 'gadget', 'computer', 
                'laptop', 'tablet', 'smart', 'electronic', 'platform'
            ]
        };
        
        // Count matches for each domain
        const domainScores = {};
        Object.keys(domainDictionaries).forEach(domain => {
            const keywords = domainDictionaries[domain];
            const matches = questionTexts.filter(text => 
                keywords.some(keyword => 
                    text.toLowerCase().includes(keyword)
                )
            ).length;
            domainScores[domain] = matches;
        });
        
        // Check if we have a clear domain match
        const maxScore = Math.max(...Object.values(domainScores));
        const dominantDomains = Object.entries(domainScores)
            .filter(([_, score]) => score === maxScore && score > 0)
            .map(([domain]) => domain);
        
        // If we detected a clear domain, focus on those keywords
        let domainSpecificWords = [];
        if (dominantDomains.length > 0) {
            // Get keywords from the dominant domain(s)
            dominantDomains.forEach(domain => {
                domainSpecificWords.push(...domainDictionaries[domain]);
            });
        }
        
        // Extract pre-computed topics/keywords where available
        // If no pre-computed topics, fall back to word extraction
        const allTopics = [];
        const allWords = [];
        
        nodes.forEach(node => {
            // If node has pre-computed topics, use them
            if (node.topics && Array.isArray(node.topics) && node.topics.length > 0) {
                allTopics.push(...node.topics);
            } else if (node.keywords && Array.isArray(node.keywords) && node.keywords.length > 0) {
                allTopics.push(...node.keywords);
            } else {
                // Fall back to extracting from the question text
                if (node.id) {
                    // Split the text into words and filter stop words
                    const words = node.id.toLowerCase()
                        .split(/\s+/)
                        .filter(word => 
                            word.length > 3 && 
                            !['what', 'which', 'when', 'where', 'who', 'whom', 'whose', 'why', 'how',
                             'do', 'does', 'did', 'can', 'could', 'would', 'should', 'will', 'shall',
                             'may', 'might', 'must', 'have', 'has', 'had', 'been', 'being', 'are', 'is',
                             'was', 'were', 'am', 'the', 'and', 'but', 'for', 'nor', 'or', 'so', 'yet',
                             'a', 'an', 'in', 'on', 'at', 'by', 'to', 'from', 'with', 'about', 'against',
                             'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
                             'that', 'this', 'these', 'those', 'your', 'you', 'use', 'used', 'using',
                             'more', 'most', 'other', 'some', 'such', 'than', 'then', 'ever', 'look',
                             'take', 'want'].includes(word));
                    allWords.push(...words);
                }
            }
        });
        
        // Process topics and words
        let topicCounts = {};
        let wordCounts = {};
        
        // Count topics
        allTopics.forEach(topic => {
            topicCounts[topic] = (topicCounts[topic] || 0) + 1;
        });
        
        // Count words from text extraction with domain-specific boosting
        allWords.forEach(word => {
            let weight = 1;
            // Boost domain-specific words
            if (domainSpecificWords.includes(word)) {
                weight = 3; // Triple the weight for domain-specific terms
            }
            wordCounts[word] = (wordCounts[word] || 0) + weight;
        });
        
        // Prioritize pre-computed topics if available
        let topKeywords;
        if (Object.keys(topicCounts).length > 0) {
            // Use pre-computed topics
            topKeywords = Object.entries(topicCounts)
                .sort((a, b) => b[1] - a[1])
                .map(entry => entry[0])
                .slice(0, 3);
        } else {
            // Fall back to word extraction
            topKeywords = Object.entries(wordCounts)
                .sort((a, b) => b[1] - a[1])
                .filter(entry => entry[1] >= 2) // Word must appear at least twice
                .map(entry => entry[0])
                .slice(0, 3);
        }
        
        // If we have dominant domains but no clear keywords, use the domain name
        if (topKeywords.length === 0 && dominantDomains.length > 0) {
            return dominantDomains[0]; // Use the first dominant domain as label
        }
        
        if (topKeywords.length === 0) {
            // If no good keywords found, use a default label
            return `Cluster ${nodeIds.length}`;
        }
        
        // Generate label with capitalized keywords
        return topKeywords.map(word => 
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
    }

    // Create cluster labels
    function createClusterLabels(clusters) {
        // Remove existing cluster labels if any
        g.selectAll(".cluster-label").remove();
        
        // If we have pre-computed clusters in the data, use those
        if (graphData.clusters && graphData.clusters.length > 0) {
            // Create a map of nodes to their positions
            const nodePositions = new Map();
            graphData.nodes.forEach(node => {
                if (node.x && node.y) {
                    nodePositions.set(node.id, {x: node.x, y: node.y});
                }
            });
            
            // Calculate all cluster centers based on node positions
            const clusterData = [];
            
            graphData.clusters.forEach(cluster => {
                // Find all nodes in this cluster
                const clusterNodes = graphData.nodes.filter(node => 
                    node.cluster_id === cluster.id
                );
                
                if (clusterNodes.length >= 3) { // Only consider clusters with 3 or more nodes
                    // Calculate cluster center
                    const center = { x: 0, y: 0 };
                    let validNodes = 0;
                    
                    clusterNodes.forEach(node => {
                        if (node && typeof node.x === 'number' && typeof node.y === 'number') {
                            center.x += node.x;
                            center.y += node.y;
                            validNodes++;
                        }
                    });
                    
                    if (validNodes > 0) {
                        center.x /= validNodes;
                        center.y /= validNodes;
                        
                        // Store cluster data for processing
                        clusterData.push({
                            id: cluster.id,
                            center: center,
                            label: cluster.label,
                            size: cluster.size,
                            nodes: clusterNodes.map(n => n.id)
                        });
                    }
                }
            });
            
            // Continue with the existing label rendering code
            // Sort clusters by size (largest first) so larger clusters get label priority
            clusterData.sort((a, b) => b.size - a.size);
            
            // Track which clusters get labels
            const labeledClusters = new Set();
            
            // Keep track of label bounding regions to prevent overlap
            const labelRegions = [];
            
            // Process clusters for labels
            clusterData.forEach(cluster => {
                // Check if this label would overlap with existing labels
                let canLabel = true;
                const estimatedLabelWidth = cluster.label.length * 10; // Rough estimate
                const estimatedLabelHeight = 20;
                
                // Define the bounding rectangle for this potential label
                const labelRect = {
                    left: cluster.center.x - estimatedLabelWidth / 2,
                    right: cluster.center.x + estimatedLabelWidth / 2,
                    top: cluster.center.y - estimatedLabelHeight / 2,
                    bottom: cluster.center.y + estimatedLabelHeight / 2
                };
                
                // Check against existing label regions
                for (const region of labelRegions) {
                    if (!(labelRect.right < region.left || 
                        labelRect.left > region.right || 
                        labelRect.bottom < region.top || 
                        labelRect.top > region.bottom)) {
                        // Overlap detected
                        canLabel = false;
                        break;
                    }
                }
                
                if (canLabel) {
                    // Add this label region to our tracking
                    labelRegions.push(labelRect);
                    labeledClusters.add(cluster.id);
                    
                    // Create label group
                    const labelGroup = g.append("g")
                        .attr("class", "cluster-label")
                        .attr("transform", `translate(${cluster.center.x},${cluster.center.y})`);
                    
                    // Add text with shadow for better visibility
                    const textNode = labelGroup.append("text")
                        .attr("text-anchor", "middle")
                        .attr("dominant-baseline", "middle")
                        .attr("fill", "white")
                        .attr("opacity", 0.9)
                        .attr("font-size", Math.min(18, Math.max(12, 8 + cluster.size / 2)) + "px")
                        .attr("font-weight", "700")
                        .style("letter-spacing", "0.5px")
                        .style("text-transform", "uppercase")
                        .style("text-shadow", "0 1px 3px rgba(0,0,0,0.9), 0 1px 10px rgba(0,0,0,1)")
                        .text(cluster.label);
                }
            });
        } else {
            // Fallback to the existing cluster detection and labeling if no pre-computed clusters
            // Calculate all cluster centers first
            const clusterData = [];
            
            clusters.forEach((nodeIds, clusterId) => {
                if (nodeIds.length >= 3) { // Only consider clusters with 3 or more nodes
                    // Calculate cluster center
                    const center = { x: 0, y: 0 };
                    let validNodes = 0;
                    
                    nodeIds.forEach(nodeId => {
                        const node = graphData.nodes.find(n => n.id === nodeId);
                        if (node && typeof node.x === 'number' && typeof node.y === 'number') {
                            center.x += node.x;
                            center.y += node.y;
                            validNodes++;
                        }
                    });
                    
                    if (validNodes > 0) {
                        center.x /= validNodes;
                        center.y /= validNodes;
                        
                        // Generate label from keywords
                        const label = getClusterKeywords(nodeIds);
                        if (!label) return; // Skip if no label generated
                        
                        // Store cluster data for processing
                        clusterData.push({
                            id: clusterId,
                            center: center,
                            label: label,
                            size: nodeIds.length,
                            nodes: nodeIds
                        });
                    }
                }
            });
            
            // Sort clusters by size (largest first) so larger clusters get label priority
            clusterData.sort((a, b) => b.size - a.size);
            
            // Track which clusters get labels
            const labeledClusters = new Set();
            
            // Keep track of label bounding regions to prevent overlap
            const labelRegions = [];
            
            // Process clusters for labels
            clusterData.forEach(cluster => {
                // Check if this label would overlap with existing labels
                let canLabel = true;
                const estimatedLabelWidth = cluster.label.length * 10; // Rough estimate
                const estimatedLabelHeight = 20;
                
                // Define the bounding rectangle for this potential label
                const labelRect = {
                    left: cluster.center.x - estimatedLabelWidth / 2,
                    right: cluster.center.x + estimatedLabelWidth / 2,
                    top: cluster.center.y - estimatedLabelHeight / 2,
                    bottom: cluster.center.y + estimatedLabelHeight / 2
                };
                
                // Check against existing label regions
                for (const region of labelRegions) {
                    if (!(labelRect.right < region.left || 
                          labelRect.left > region.right || 
                          labelRect.bottom < region.top || 
                          labelRect.top > region.bottom)) {
                        // Overlap detected
                        canLabel = false;
                        break;
                    }
                }
                
                if (canLabel) {
                    // Add this label region to our tracking
                    labelRegions.push(labelRect);
                    labeledClusters.add(cluster.id);
                    
                    // Create label group
                    const labelGroup = g.append("g")
                        .attr("class", "cluster-label")
                        .attr("transform", `translate(${cluster.center.x},${cluster.center.y})`);
                    
                    // Add text with shadow for better visibility
                    const textNode = labelGroup.append("text")
                        .attr("text-anchor", "middle")
                        .attr("dominant-baseline", "middle")
                        .attr("fill", "white")
                        .attr("opacity", 0.9)
                        .attr("font-size", Math.min(18, Math.max(12, 8 + cluster.size / 2)) + "px")
                        .attr("font-weight", "700")
                        .style("letter-spacing", "0.5px")
                        .style("text-transform", "uppercase")
                        .style("text-shadow", "0 1px 3px rgba(0,0,0,0.9), 0 1px 10px rgba(0,0,0,1)")
                        .text(cluster.label);
                }
            });
        }
    }
}); 