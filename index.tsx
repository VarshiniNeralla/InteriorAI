import React, { useState, useRef, useCallback, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Modality, Part } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

interface Product {
  id: number;
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  aspectRatio: number;
  description: string;
}

const loadingMessages = [
  "Harmonizing your design...",
  "Adjusting lighting and shadows...",
  "Blending colors for a natural look...",
  "Analyzing perspective...",
  "Adding the finishing touches...",
];

const App = () => {
  const [originalRoomImage, setOriginalRoomImage] = useState<string | null>(null);
  const [displayImage, setDisplayImage] = useState<string | null>(null);
  const [availableProducts, setAvailableProducts] = useState<{ src: string; description: string; }[]>([]);
  const [placedProducts, setPlacedProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessingProducts, setIsProcessingProducts] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState(loadingMessages[0]);
  const [error, setError] = useState<string | null>(null);
  const [previousState, setPreviousState] = useState<{ displayImage: string | null; placedProducts: Product[] } | null>(null);
  const [userInstructions, setUserInstructions] = useState('');


  const workspaceRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const interactionState = useRef<{
    type: 'move' | 'resize' | null;
    productId: number;
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  useEffect(() => {
    if (isLoading) {
      const interval = setInterval(() => {
        setLoadingMessage(prev => {
          const currentIndex = loadingMessages.indexOf(prev);
          return loadingMessages[(currentIndex + 1) % loadingMessages.length];
        });
      }, 2500);
      return () => clearInterval(interval);
    }
  }, [isLoading]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, setter: (urls: string[]) => void, multiple: boolean) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      if (files.length === 0) return;
      const urls: string[] = [];
      let filesProcessed = 0;
      files.forEach(file => {
        const reader = new FileReader();
        reader.onload = () => {
          urls.push(reader.result as string);
          filesProcessed++;
          if (filesProcessed === files.length) {
            setter(urls);
          }
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const handleRoomUpload = (urls: string[]) => {
    setOriginalRoomImage(urls[0]);
    setDisplayImage(urls[0]);
    setPlacedProducts([]);
  };

  const handleProductUpload = async (urls: string[]) => {
    setIsProcessingProducts(true);
    setError(null);
    try {
      const newProducts = await Promise.all(
        urls.map(async (url) => {
          const base64Data = url.split(',')[1];
          const mimeType = url.match(/:(.*?);/)?.[1];
          if (!base64Data || !mimeType) {
              console.error("Invalid data URL for product image.");
              return { src: url, description: 'a product' };
          }

          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{
              parts: [
                { inlineData: { data: base64Data, mimeType } },
                { text: "Describe this product in a short phrase for an interior design app. For example: 'a modern yellow armchair' or 'a rustic wooden coffee table'. Be concise and descriptive. Do not add any preamble like 'This is' or quotes." }
              ]
            }],
          });
          
          const description = response.text.trim();
          return { src: url, description };
        })
      );
      setAvailableProducts(prev => [...prev, ...newProducts]);
    } catch (err) {
        console.error("Failed to process products:", err);
        setError("Could not generate product descriptions. Please try again.");
    } finally {
        setIsProcessingProducts(false);
    }
  };

  const handleDragStart = (e: React.DragEvent<HTMLImageElement>, product: { src: string; description: string }) => {
    e.dataTransfer.setData("application/json", JSON.stringify(product));
  };
  
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const data = e.dataTransfer.getData("application/json");
    if (!data) return;

    const { src, description } = JSON.parse(data);
    const workspaceRect = workspaceRef.current?.getBoundingClientRect();

    if (src && workspaceRect) {
      const img = new Image();
      img.src = src;
      img.onload = () => {
        const aspectRatio = img.width / img.height;
        const newProduct: Product = {
          id: Date.now(),
          src,
          description,
          x: e.clientX - workspaceRect.left - 75,
          y: e.clientY - workspaceRect.top - (75 / aspectRatio) / 2,
          width: 150,
          height: 150 / aspectRatio,
          aspectRatio,
        };
        setPlacedProducts(prev => [...prev, newProduct]);
        setSelectedProductId(newProduct.id);
      }
    }
  };

  const handleMouseDown = (e: React.MouseEvent, productId: number, type: 'move' | 'resize') => {
    e.stopPropagation();
    setSelectedProductId(productId);
    const product = placedProducts.find(p => p.id === productId);
    if (!product || !workspaceRef.current) return;
    
    interactionState.current = {
      type,
      productId,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: product.x,
      startTop: product.y,
      startWidth: product.width,
      startHeight: product.height,
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!interactionState.current) return;

    const { type, productId, startX, startY, startLeft, startTop, startWidth, startHeight } = interactionState.current;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    setPlacedProducts(prev => prev.map(p => {
      if (p.id === productId) {
        if (type === 'move') {
          return { ...p, x: startLeft + dx, y: startTop + dy };
        }
        if (type === 'resize') {
          const newWidth = startWidth + dx;
          const newHeight = newWidth / p.aspectRatio;
          return { ...p, width: newWidth > 20 ? newWidth : 20, height: newHeight > (20 / p.aspectRatio) ? newHeight : (20/p.aspectRatio) };
        }
      }
      return p;
    }));
  }, []);

  const handleMouseUp = useCallback(() => {
    interactionState.current = null;
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseMove]);
  
  const handleWorkspaceClick = () => {
      setSelectedProductId(null);
  }

  const handleReset = () => {
    setDisplayImage(originalRoomImage);
    setPlacedProducts([]);
    setError(null);
    setPreviousState(null);
  };
  
  const handleUndo = () => {
    if (previousState) {
      setDisplayImage(previousState.displayImage);
      setPlacedProducts(previousState.placedProducts);
      setPreviousState(null);
    }
  };

  const handleDownload = () => {
    if (!displayImage) return;
    const link = document.createElement('a');
    link.href = displayImage;
    link.download = `design-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  const handleHarmonize = async () => {
    if (!displayImage || placedProducts.length === 0) {
      setError("Please add a product to the room before harmonizing.");
      return;
    }
    
    setPreviousState({ displayImage, placedProducts: [...placedProducts] });
    setIsLoading(true);
    setError(null);

    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx || !imageRef.current) {
        throw new Error("Could not process image.");
      }

      const baseImage = imageRef.current;
      const { naturalWidth, naturalHeight, clientWidth, clientHeight } = baseImage;

      canvas.width = naturalWidth;
      canvas.height = naturalHeight;

      ctx.drawImage(baseImage, 0, 0, naturalWidth, naturalHeight);

      const scaleX = naturalWidth / clientWidth;
      const scaleY = naturalHeight / clientHeight;

      const imageLoadPromises = placedProducts.map(product => {
        return new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = product.src;
        });
      });

      const loadedProductImages = await Promise.all(imageLoadPromises);

      loadedProductImages.forEach((productImg, index) => {
        const product = placedProducts[index];
        ctx.drawImage(productImg, product.x * scaleX, product.y * scaleY, product.width * scaleX, product.height * scaleY);
      });

      const compositeImageData = canvas.toDataURL('image/jpeg').split(',')[1];
      
      const productDescriptions = placedProducts.map(p => p.description).join(', ');
      
      let promptText = `Your task is to seamlessly integrate the following product(s) into the provided room image: ${productDescriptions}. Your main goal is to make the products look natural by adjusting lighting, shadows, and colors. Preserve all other details of the original image. Do not add any products that the user did not place.`;

      if (userInstructions.trim() !== '') {
        promptText += `\n\nIMPORTANT USER INSTRUCTIONS: "${userInstructions.trim()}". You MUST follow these instructions. This may require you to change the orientation or perspective of the product(s) significantly. For example, if the user asks to make a sofa flush against the back wall, you must rotate it to face forward and align its perspective with that wall. The size and general position provided by the user should be respected as much as possible while fulfilling the instruction.`;
      } else {
        promptText += `\n\nIt is absolutely critical that you DO NOT change the size, position, or aspect ratio of the added product(s). The products are placed exactly where the user wants them. Your only job is to adjust lighting, shadows, and colors to make the products look like they naturally belong in the room. You may only make very subtle adjustments to the perspective to better align the product with the scene if necessary.`;
      }

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: [{
          parts: [
            { inlineData: { data: compositeImageData, mimeType: 'image/jpeg' } },
            { text: promptText }
          ]
        }],
        config: {
          responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
      });

      const imagePart = response.candidates?.[0]?.content?.parts.find((p: Part) => p.inlineData);
      if (imagePart && imagePart.inlineData) {
        const newImageDataBase64 = imagePart.inlineData.data;
        const newImageDataUrl = `data:${imagePart.inlineData.mimeType};base64,${newImageDataBase64}`;
        setDisplayImage(newImageDataUrl);
        setPlacedProducts([]);
      } else {
        throw new Error("No image was returned from the API.");
      }
    } catch (err) {
      console.error("Harmonization failed:", err);
      setError("Sorry, we couldn't harmonize your image. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-gray-100 text-gray-800">
      <aside className="w-80 bg-white p-6 shadow-lg flex flex-col space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-indigo-600">Interior AI</h1>
          <p className="text-sm text-gray-500">Visualize your dream room</p>
        </header>
        
        <div className="space-y-4">
          <label className="block w-full text-center px-4 py-2 bg-indigo-600 text-white rounded-md shadow-sm hover:bg-indigo-700 cursor-pointer transition-colors">
            Upload Room Image
            <input type="file" accept="image/jpeg, image/png" className="hidden" onChange={e => handleFileChange(e, handleRoomUpload, false)} />
          </label>
          {originalRoomImage && (
             <label className={`block w-full text-center px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 cursor-pointer transition-colors ${isProcessingProducts ? 'cursor-not-allowed opacity-50' : ''}`}>
              {isProcessingProducts ? 'Processing...' : 'Upload Products'}
              <input type="file" accept="image/png, image/jpeg" className="hidden" multiple onChange={e => handleFileChange(e, handleProductUpload, true)} disabled={isProcessingProducts} />
            </label>
          )}
        </div>

        {originalRoomImage && (
            // <div className="space-y-2">
            //     <h2 className="font-semibold text-gray-800">Special Instructions</h2>
            //     <p className="text-xs text-gray-500">e.g., "Rotate the armchair to be flush against the back wall."</p>
            //     <textarea
            //       className="w-full h-24 p-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
            //       placeholder="Tell the AI how to orient the products..."
            //       value={userInstructions}
            //       onChange={(e) => setUserInstructions(e.target.value)}
            //       aria-label="Special instructions for AI"
            //     />
            // </div>
            <div className="space-y-2">
  <h2 className="font-semibold text-gray-800">Special Instructions</h2>
  <p className="text-xs text-gray-500">e.g., "Rotate the armchair to be flush against the back wall."</p>
  <textarea
    className="w-full h-24 p-2 border border-gray-300 rounded-md text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
    placeholder="Tell the AI how to orient the products..."
    value={userInstructions}
    onChange={(e) => setUserInstructions(e.target.value)}
    aria-label="Special instructions for AI"
  />
</div>

        )}

        <div className="flex-grow overflow-y-auto border-t pt-4">
            <h2 className="font-semibold mb-2">Your Products</h2>
            {isProcessingProducts && (
                <div className="flex items-center space-x-2 text-sm text-gray-500">
                    <svg className="animate-spin h-4 w-4 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Analyzing products...</span>
                </div>
            )}
            {availableProducts.length === 0 && !isProcessingProducts ? (
                <p className="text-xs text-gray-400">Upload product images to get started.</p>
            ) : (
                <div className="grid grid-cols-3 gap-2">
                    {availableProducts.map((product, index) => (
                        <div key={index} className="aspect-square border rounded-md p-1 hover:border-indigo-400" title={product.description}>
                            <img
                                src={product.src}
                                draggable
                                onDragStart={e => handleDragStart(e, product)}
                                className="w-full h-full object-contain cursor-grab"
                                alt={product.description}
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
      </aside>

      <main className="flex-1 flex flex-col p-6">
        <div 
          ref={workspaceRef}
          onDrop={handleDrop} 
          onDragOver={e => e.preventDefault()}
          onClick={handleWorkspaceClick}
          className="relative w-full h-full bg-white rounded-xl shadow-inner flex items-center justify-center overflow-hidden"
        >
          {isLoading && (
            <div className="absolute inset-0 bg-gray-900 bg-opacity-70 z-30 flex flex-col items-center justify-center">
                <svg className="animate-spin h-10 w-10 text-white mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <p className="text-white text-lg font-medium">{loadingMessage}</p>
            </div>
          )}

          {!displayImage ? (
            <div className="text-center text-gray-400">
                <p className="text-lg font-medium">Upload a room image to begin</p>
                <p>Then, upload products and drag them here.</p>
            </div>
          ) : (
            <>
                <img ref={imageRef} src={displayImage} className="max-w-full max-h-full object-contain" alt="Room background"/>
                {placedProducts.map(product => (
                    <div
                        key={product.id}
                        onMouseDown={e => handleMouseDown(e, product.id, 'move')}
                        className="absolute cursor-move select-none"
                        style={{
                            left: product.x,
                            top: product.y,
                            width: product.width,
                            height: product.height,
                            border: selectedProductId === product.id ? '2px dashed #4f46e5' : 'none',
                        }}
                    >
                        <img src={product.src} className="w-full h-full object-contain" alt={product.description} draggable={false}/>
                        {selectedProductId === product.id && (
                             <div 
                                className="resize-handle"
                                onMouseDown={e => handleMouseDown(e, product.id, 'resize')}
                              ></div>
                        )}
                    </div>
                ))}
            </>
          )}
        </div>
        <footer className="flex-shrink-0 pt-4 flex items-center justify-between">
            <div>
              {error && <p className="text-red-500">{error}</p>}
            </div>
            <div className="flex items-center space-x-4">
                {originalRoomImage && <button onClick={handleReset} className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition-colors">Reset</button>}
                {previousState && placedProducts.length === 0 && !isLoading && (
                    <button onClick={handleUndo} className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition-colors">Undo</button>
                )}
                {displayImage && <button onClick={handleDownload} className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition-colors">Download</button>}
                {placedProducts.length > 0 && <button onClick={handleHarmonize} disabled={isLoading} className="px-6 py-2 bg-indigo-600 text-white rounded-md shadow-sm hover:bg-indigo-700 transition-colors disabled:bg-indigo-300 disabled:cursor-not-allowed">Harmonize</button>}
            </div>
        </footer>
      </main>
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);