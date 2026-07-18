import { useRef, useState } from 'react';

function PhotoUpload({ onFileSelected, previewUrl }) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef(null);

  const handleFiles = (files) => {
    const file = files?.[0];
    if (file && file.type.startsWith('image/')) {
      onFileSelected(file);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div
      className={`photo-upload ${isDragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />
      {previewUrl ? (
        <img className="photo-preview" src={previewUrl} alt="Inspiration preview" />
      ) : (
        <div className="photo-upload-placeholder">
          <p>Drag & drop an inspiration photo here</p>
          <p className="photo-upload-subtext">or click to choose a file</p>
        </div>
      )}
    </div>
  );
}

export default PhotoUpload;
